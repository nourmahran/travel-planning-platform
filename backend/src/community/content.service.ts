import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { CommunityStore } from './store';
import { TeamBridge } from './team.bridge';
import {
  Actor,
  Content,
  ContentType,
  MediaTarget,
  objectId,
  PostStatus,
  ReportStatus,
  Role,
} from './types';

@Injectable()
export class ContentService {
  constructor(
    private readonly store: CommunityStore,
    private readonly bridge: TeamBridge,
  ) {}

  async get(
    type: ContentType,
    id: string,
    session?: ClientSession,
  ): Promise<Content> {
    if (type === ContentType.Post) {
      const post = await this.store.posts
        .findById(id)
        .session(session ?? null)
        .lean();
      if (!post) throw new NotFoundException('Post not found');
      return post;
    }
    if (type === ContentType.Comment) {
      const comment = await this.store.comments
        .findById(id)
        .session(session ?? null)
        .lean();
      if (!comment) throw new NotFoundException('Comment not found');
      return comment;
    }
    return this.bridge.content(type, id, session);
  }

  owns(content: Content, actor?: Actor) {
    return !!actor && content.authorId?.toString() === actor.id;
  }

  requireOwner(content: Content, actor: Actor) {
    if (!this.owns(content, actor))
      throw new ForbiddenException('Only the author can change this content');
  }

  async readable(
    type: ContentType,
    id: string,
    actor?: Actor,
    session?: ClientSession,
  ) {
    const content = await this.get(type, id, session);
    const privileged = actor?.role === Role.Admin || this.owns(content, actor);
    if (content.hidden && !privileged)
      throw new NotFoundException('Content not found');
    if (
      type === ContentType.Post &&
      content.status !== PostStatus.Published &&
      !privileged
    ) {
      throw new NotFoundException('Post not found');
    }
    if (
      type === ContentType.Itinerary &&
      content.visibility !== 'Public' &&
      !privileged
    ) {
      throw new NotFoundException('Itinerary not found');
    }
    if (type === ContentType.Post || type === ContentType.Itinerary) {
      const author = await this.bridge.account(
        content.authorId.toString(),
        session,
      );
      if (
        (!author || author.status === 'deactivated') &&
        actor?.role !== Role.Admin
      ) {
        throw new NotFoundException('Content not found');
      }
    }
    if (type === ContentType.Comment && content.postId) {
      await this.readable(
        ContentType.Post,
        content.postId.toString(),
        actor,
        session,
      );
    }
    return content;
  }

  async lock(type: ContentType, id: string, session: ClientSession) {
    if (type === ContentType.Post) {
      const post = await this.store.posts
        .findByIdAndUpdate(
          id,
          { $inc: { communityVersion: 1 } },
          { session, returnDocument: 'after' },
        )
        .lean();
      if (!post) throw new NotFoundException('Post not found');
      return post as Content;
    }
    if (type === ContentType.Comment) {
      const comment = await this.get(type, id, session);
      await this.lock(ContentType.Post, comment.postId!.toString(), session);
      return this.get(type, id, session);
    }
    return this.bridge.lock(type, id, session);
  }

  async publicTarget(type: ContentType, id: string, session: ClientSession) {
    await this.lock(type, id, session);
    return this.readable(type, id, undefined, session);
  }

  async hide(type: ContentType, id: string, session: ClientSession) {
    if (type === ContentType.Post) {
      await this.store.posts.updateOne(
        { _id: objectId(id) },
        { $set: { hidden: true } },
        { session },
      );
    } else if (type === ContentType.Comment) {
      await this.store.comments.updateOne(
        { _id: objectId(id) },
        { $set: { hidden: true } },
        { session },
      );
    } else {
      await this.bridge.hide(type, id, session);
    }
  }

  async closeReports(
    type: ContentType,
    ids: Types.ObjectId[],
    actor: Actor,
    session: ClientSession,
    note: string,
  ) {
    await this.store.reports.updateMany(
      { targetType: type, targetId: { $in: ids }, status: ReportStatus.Open },
      {
        $set: {
          status: ReportStatus.Deleted,
          resolvedBy: objectId(actor.id),
          resolvedAt: new Date(),
          resolutionNote: note,
        },
      },
      { session },
    );
  }

  async remove(
    type: ContentType,
    id: string,
    actor: Actor,
    session: ClientSession,
  ) {
    if (type === ContentType.Post) {
      const comments = await this.store.comments
        .find({ postId: objectId(id) }, { _id: 1 })
        .session(session)
        .lean();
      await this.closeReports(
        ContentType.Comment,
        comments.map((comment) => comment._id),
        actor,
        session,
        'Parent post deleted',
      );
      await this.store.comments.deleteMany(
        { postId: objectId(id) },
        { session },
      );
      await this.store.likes.deleteMany({ postId: objectId(id) }, { session });
      await this.store.media.deleteMany(
        { targetType: MediaTarget.Post, targetId: objectId(id) },
        { session },
      );
      await this.store.posts.deleteOne({ _id: objectId(id) }, { session });
    } else if (type === ContentType.Comment) {
      await this.store.comments.deleteOne({ _id: objectId(id) }, { session });
    } else {
      await this.bridge.remove(type, id, session);
    }
    await this.closeReports(
      type,
      [objectId(id)],
      actor,
      session,
      'Content deleted',
    );
  }

  async mediaTarget(
    type: MediaTarget,
    id: string,
    actor?: Actor,
    write = false,
    session?: ClientSession,
  ) {
    if (type === MediaTarget.Post) {
      const post =
        session && write
          ? await this.lock(ContentType.Post, id, session)
          : await this.get(ContentType.Post, id, session);
      if (write) this.requireOwner(post, actor!);
      else await this.readable(ContentType.Post, id, actor, session);
      return;
    }
    let target = await this.bridge.content(type, id, session);
    if (type === MediaTarget.Activity) {
      if (!target.itineraryId)
        throw new NotFoundException('Activity itinerary not found');
      const itineraryId = target.itineraryId.toString();
      const itinerary =
        session && write
          ? await this.lock(ContentType.Itinerary, itineraryId, session)
          : await this.get(ContentType.Itinerary, itineraryId, session);
      if (write) this.requireOwner(itinerary, actor!);
      else
        await this.readable(ContentType.Itinerary, itineraryId, actor, session);
    } else {
      const moderator =
        actor &&
        ((type === MediaTarget.Hotel &&
          actor.role === Role.HotelModerator &&
          actor.assignedHotelId === id) ||
          (type === MediaTarget.Airline &&
            actor.role === Role.AirlineModerator &&
            actor.assignedAirlineId === id));
      const allowed = actor?.role === Role.Admin || moderator;
      if (write && !allowed)
        throw new ForbiddenException(
          'Only the assigned moderator or administrator can manage these images',
        );
      if (
        !write &&
        (target as Content & { active?: boolean }).active === false &&
        !allowed
      ) {
        throw new NotFoundException('Provider not found');
      }
    }
    // Activities are embedded in their itinerary, which was locked above;
    // there is no standalone activity document to lock.
    if (write && session && type !== MediaTarget.Activity)
      target = await this.bridge.lock(type, id, session);
  }
}
