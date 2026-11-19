import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PipelineStage } from 'mongoose';
import {
  AuthorQueryDto,
  CreatePostDto,
  MinePostsDto,
  SearchPostsDto,
  UpdatePostDto,
} from './dto/community.dto';
import { ContentService } from './content.service';
import { CommunityStore } from './store';
import { TeamBridge } from './team.bridge';
import {
  Actor,
  ContentType,
  escapeRegex,
  objectId,
  MediaTarget,
  PAGE_SIZE,
  pageResult,
  PostStatus,
  Role,
} from './types';

@Injectable()
export class BlogService {
  constructor(
    private readonly store: CommunityStore,
    private readonly content: ContentService,
    private readonly bridge: TeamBridge,
  ) {}

  async create(actor: Actor, dto: CreatePostDto) {
    if (dto.itineraryId) await this.bridge.attachableItinerary(dto.itineraryId, actor.id);
    return this.store.posts.create({
      authorId: objectId(actor.id),
      itineraryId: dto.itineraryId ? objectId(dto.itineraryId) : undefined,
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      status: dto.status ?? PostStatus.Draft,
      publishedAt: dto.status === PostStatus.Published ? new Date() : undefined,
    });
  }

  async update(actor: Actor, id: string, dto: UpdatePostDto) {
    if (!Object.keys(dto).length)
      throw new BadRequestException('Provide at least one post field');
    return this.store.transaction(async (session) => {
      const post = await this.content.lock(ContentType.Post, id, session);
      this.content.requireOwner(post, actor);
      if (dto.itineraryId) await this.bridge.attachableItinerary(dto.itineraryId, actor.id, session);
      const changes = { ...dto } as UpdatePostDto & { publishedAt?: Date };
      if (dto.itineraryId) changes.itineraryId = objectId(dto.itineraryId) as unknown as string;
      if (
        dto.status === PostStatus.Published &&
        post.status !== PostStatus.Published
      ) {
        changes.publishedAt = new Date();
      }
      return this.store.posts
        .findByIdAndUpdate(
          id,
          { $set: changes },
          { session, returnDocument: 'after', runValidators: true },
        )
        .lean();
    });
  }

  async remove(actor: Actor, id: string) {
    return this.store.transaction(async (session) => {
      const post = await this.content.lock(ContentType.Post, id, session);
      this.content.requireOwner(post, actor);
      await this.content.remove(ContentType.Post, id, actor, session);
      return { deleted: true };
    });
  }

  countPipeline(): PipelineStage[] {
    return [
      {
        $lookup: {
          from: 'likes',
          let: { postId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$postId', '$$postId'] } } },
            { $count: 'value' },
          ],
          as: 'likes',
        },
      },
      {
        $lookup: {
          from: 'comments',
          let: { postId: '$_id' },
          pipeline: [
            {
              $match: {
                hidden: { $ne: true },
                $expr: { $eq: ['$postId', '$$postId'] },
              },
            },
            { $count: 'value' },
          ],
          as: 'comments',
        },
      },
      {
        $set: {
          likeCount: { $ifNull: [{ $arrayElemAt: ['$likes.value', 0] }, 0] },
          commentCount: {
            $ifNull: [{ $arrayElemAt: ['$comments.value', 0] }, 0],
          },
        },
      },
      { $set: { interactionScore: { $add: ['$likeCount', '$commentCount'] } } },
    ];
  }

  async list(dto: SearchPostsDto, authorId?: string) {
    const match: Record<string, unknown> = {
      status: PostStatus.Published,
      hidden: { $ne: true },
    };
    if (dto.tag) match.tags = dto.tag;
    if (authorId) match.authorId = objectId(authorId);
    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: this.bridge.accountsCollection,
          localField: 'authorId',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1, status: 1 } }],
          as: 'author',
        },
      },
      { $unwind: '$author' },
      { $match: { 'author.status': { $ne: 'deactivated' } } },
    ];
    if (dto.q) {
      const regex = new RegExp(escapeRegex(dto.q), 'i');
      pipeline.push({
        $match: {
          $or: [{ title: regex }, { tags: regex }, { 'author.name': regex }],
        },
      });
    }
    pipeline.push(
      ...this.countPipeline(),
      {
        $sort: {
          interactionScore: -1,
          publishedAt: -1,
          createdAt: -1,
          _id: -1,
        },
      },
      {
        $facet: {
          items: [
            { $skip: (dto.page - 1) * PAGE_SIZE },
            { $limit: PAGE_SIZE },
            {
              $project: {
                title: 1,
                status: 1,
                tags: 1,
                createdAt: 1,
                publishedAt: 1,
                author: { id: '$author._id', name: '$author.name' },
                excerpt: { $substrCP: ['$body', 0, 200] },
                likeCount: 1,
                commentCount: 1,
                interactionScore: 1,
              },
            },
          ],
          total: [{ $count: 'value' }],
        },
      },
    );
    const [result] = await this.store.posts.aggregate(pipeline);
    return pageResult(
      result?.items ?? [],
      result?.total[0]?.value ?? 0,
      dto.page,
    );
  }

  async mine(actor: Actor, dto: MinePostsDto) {
    const match: Record<string, unknown> = { authorId: objectId(actor.id) };
    if (dto.status) match.status = dto.status;
    const [result] = await this.store.posts.aggregate([
      { $match: match },
      ...this.countPipeline(),
      { $sort: { updatedAt: -1, _id: -1 } },
      {
        $facet: {
          items: [
            { $skip: (dto.page - 1) * PAGE_SIZE },
            { $limit: PAGE_SIZE },
            {
              $project: {
                title: 1,
                status: 1,
                hidden: 1,
                createdAt: 1,
                updatedAt: 1,
                publishedAt: 1,
                likeCount: 1,
                commentCount: 1,
              },
            },
          ],
          total: [{ $count: 'value' }],
        },
      },
    ]);
    return pageResult(
      result?.items ?? [],
      result?.total[0]?.value ?? 0,
      dto.page,
    );
  }

  async detail(id: string, actor?: Actor) {
    await this.content.readable(ContentType.Post, id, actor);
    const post = await this.store.posts.findById(id).lean();
    if (!post) throw new NotFoundException('Post not found');
    const likeCount = await this.store.likes.countDocuments({
      postId: post._id,
    });
    const comments = await this.comments(id, 1, actor);
    const images = await this.store.media
      .find({ targetType: MediaTarget.Post, targetId: post._id })
      .sort({ createdAt: 1 })
      .lean();
    const itinerary = post.itineraryId
      ? await this.bridge.visibleAttachedItinerary(post.itineraryId.toString())
      : null;
    return {
      ...post,
      itineraryId: itinerary?._id ?? null,
      itinerary,
      author: await this.bridge.authorLabel(post.authorId.toString()),
      likeCount,
      commentCount: comments.total,
      comments,
      likedByMe: actor
        ? (await this.store.likes.exists({
            postId: post._id,
            userId: objectId(actor.id),
          })) !== null
        : false,
      images: images.map((image) => ({
        id: image._id,
        url: '/api/media/' + image._id.toString(),
        mimeType: image.mimeType,
        size: image.size,
      })),
    };
  }

  async comments(postId: string, page: number, actor?: Actor) {
    await this.content.readable(ContentType.Post, postId, actor);
    const filter: Record<string, unknown> = { postId: objectId(postId) };
    if (actor?.role !== Role.Admin) {
      filter.$or = [
        { hidden: { $ne: true } },
        ...(actor ? [{ authorId: objectId(actor.id) }] : []),
      ];
    }
    const total = await this.store.comments.countDocuments(filter);
    const comments = await this.store.comments
      .find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean();
    const items = await Promise.all(
      comments.map(async (comment) => ({
        ...comment,
        author: await this.bridge.authorLabel(comment.authorId.toString()),
      })),
    );
    return pageResult(items, total, page);
  }

  async addComment(actor: Actor, postId: string, body: string) {
    return this.store.transaction(async (session) => {
      await this.content.publicTarget(ContentType.Post, postId, session);
      const [comment] = await this.store.comments.create(
        [
          {
            postId: objectId(postId),
            authorId: objectId(actor.id),
            body,
          },
        ],
        { session },
      );
      return comment;
    });
  }

  async editComment(actor: Actor, id: string, body: string) {
    return this.store.transaction(async (session) => {
      const comment = await this.content.lock(ContentType.Comment, id, session);
      this.content.requireOwner(comment, actor);
      return this.store.comments
        .findByIdAndUpdate(
          id,
          { $set: { body } },
          { returnDocument: 'after', session, runValidators: true },
        )
        .lean();
    });
  }

  async deleteComment(actor: Actor, id: string) {
    return this.store.transaction(async (session) => {
      const comment = await this.content.lock(ContentType.Comment, id, session);
      this.content.requireOwner(comment, actor);
      await this.content.remove(ContentType.Comment, id, actor, session);
      return { deleted: true };
    });
  }

  async like(actor: Actor, postId: string, liked: boolean) {
    return this.store.transaction(async (session) => {
      await this.content.publicTarget(ContentType.Post, postId, session);
      const filter = { postId: objectId(postId), userId: objectId(actor.id) };
      if (liked) {
        await this.store.likes.updateOne(
          filter,
          { $setOnInsert: filter },
          { upsert: true, session },
        );
      } else {
        await this.store.likes.deleteOne(filter, { session });
      }
      return {
        liked,
        likeCount: await this.store.likes
          .countDocuments({ postId: objectId(postId) })
          .session(session),
      };
    });
  }

  async author(id: string, dto: AuthorQueryDto) {
    const author = await this.bridge.publicAuthor(id);
    return {
      ...author,
      posts: await this.list({ page: dto.postsPage }, id),
      itineraries: await this.bridge.publicItineraries(id, dto.itinerariesPage),
    };
  }
}
