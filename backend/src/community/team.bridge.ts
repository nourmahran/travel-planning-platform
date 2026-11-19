import { Injectable, NotFoundException } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { CommunityStore } from './store';
import {
  Account,
  Content,
  ContentType,
  MediaTarget,
  objectId,
  PAGE_SIZE,
  pageResult,
} from './types';

@Injectable()
export class TeamBridge {
  readonly accountsCollection = 'users';

  constructor(private readonly store: CommunityStore) {}

  async account(id: string, session?: ClientSession): Promise<Account | null> {
    const account = await this.store.connection
      .collection(this.accountsCollection)
      .findOne(
        { _id: objectId(id) },
        {
          session,
          projection: {
            name: 1,
            role: 1,
            status: 1,
            createdAt: 1,
            mustChangePassword: 1,
            providerType: 1,
            providerId: 1,
            assignedHotelId: 1,
            assignedAirlineId: 1,
          },
        },
      );
    if (!account) return null;
    return {
      ...account,
      assignedHotelId:
        account.providerType === 'hotel'
          ? account.providerId
          : account.assignedHotelId,
      assignedAirlineId:
        account.providerType === 'airline'
          ? account.providerId
          : account.assignedAirlineId,
    } as Account;
  }

  async publicAuthor(id: string) {
    const account = await this.account(id);
    if (!account || account.status === 'deactivated') {
      throw new NotFoundException('Author not found');
    }
    return {
      id: account._id.toString(),
      name: account.name,
      joinedAt: account.createdAt,
    };
  }

  async authorLabel(id: string, session?: ClientSession) {
    const account = await this.account(id, session);
    if (!account || account.status === 'deactivated') {
      return { id: null, name: 'Deleted user' };
    }
    return { id: account._id.toString(), name: account.name };
  }

  async publicItineraries(authorId: string, page: number) {
    const author = await this.account(authorId);
    if (!author || author.status === 'deactivated')
      return pageResult([], 0, page);
    const filter = {
      $or: [
        {
          ownerId: objectId(authorId),
          visibility: 'public',
          isHidden: { $ne: true },
        },
        {
          authorId: objectId(authorId),
          visibility: 'Public',
          hidden: { $ne: true },
        },
      ],
    };
    const collection = this.store.connection.collection('itineraries');
    const total = await collection.countDocuments(filter);
    const items = await collection
      .find(filter, {
        projection: {
          title: 1,
          countries: 1,
          startDate: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      })
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray();
    return pageResult(items, total, page);
  }

  async attachableItinerary(id: string, authorId: string, session?: ClientSession) {
    const itinerary = await this.store.connection.collection('itineraries').findOne(
      {
        _id: objectId(id),
        $or: [
          { ownerId: objectId(authorId), visibility: 'public', isHidden: { $ne: true } },
          { authorId: objectId(authorId), visibility: 'Public', hidden: { $ne: true } },
        ],
      },
      { session, projection: { title: 1, startDate: 1, endDate: 1 } },
    );
    if (!itinerary) throw new NotFoundException('Public itinerary not found');
    return itinerary;
  }

  async visibleAttachedItinerary(id: string) {
    const itinerary = await this.store.connection.collection('itineraries').findOne(
      {
        _id: objectId(id),
        $or: [
          { visibility: 'public', isHidden: { $ne: true } },
          { visibility: 'Public', hidden: { $ne: true } },
        ],
      },
      { projection: { title: 1, startDate: 1, endDate: 1 } },
    );
    return itinerary ?? null;
  }

  collection(type: ContentType | MediaTarget) {
    const collections: Record<string, string> = {
      review: 'reviews',
      itinerary: 'itineraries',
      activity: 'activities',
      hotel: 'hotels',
      airline: 'airlines',
    };
    const name = collections[type];
    if (!name) throw new NotFoundException('Unsupported content type');
    return this.store.connection.collection(name);
  }

  async content(
    type: ContentType | MediaTarget,
    id: string,
    session?: ClientSession,
  ) {
    if (type === MediaTarget.Activity) {
      const itinerary = await this.store.connection
        .collection('itineraries')
        .findOne({ 'days.activities._id': objectId(id) }, { session });
      if (itinerary)
        return { _id: objectId(id), itineraryId: itinerary._id } as Content;
      const activity = await this.collection(MediaTarget.Activity).findOne(
        { _id: objectId(id) },
        { session },
      );
      if (!activity) throw new NotFoundException('Activity not found');
      return activity as unknown as Content;
    }
    const record = await this.collection(type).findOne(
      { _id: objectId(id) },
      { session },
    );
    if (!record) throw new NotFoundException('Content not found');
    if (type === ContentType.Itinerary) {
      return {
        ...record,
        authorId: record.ownerId ?? record.authorId,
        hidden: record.isHidden ?? record.hidden,
        visibility:
          record.visibility === 'public'
            ? 'Public'
            : record.visibility === 'private'
              ? 'Private'
              : record.visibility,
      } as unknown as Content;
    }
    if (type === ContentType.Review) {
      return {
        ...record,
        authorId: record.userId ?? record.authorId,
        hidden: (record.isHidden ?? record.hidden) || record.isDeleted,
      } as unknown as Content;
    }
    if (type === MediaTarget.Hotel || type === MediaTarget.Airline) {
      return {
        ...record,
        active: record.isActive ?? record.active,
      } as unknown as Content;
    }
    return record as unknown as Content;
  }

  async lock(
    type: ContentType | MediaTarget,
    id: string,
    session: ClientSession,
  ) {
    const result = await this.collection(type).updateOne(
      { _id: objectId(id) },
      { $inc: { communityVersion: 1 } },
      { session },
    );
    if (!result.matchedCount) throw new NotFoundException('Content not found');
    return this.content(type, id, session);
  }

  async hide(type: ContentType, id: string, session: ClientSession) {
    const content = await this.content(type, id, session);
    await this.collection(type).updateOne(
      { _id: content._id },
      {
        $set:
          type === ContentType.Itinerary || type === ContentType.Review
            ? { isHidden: true, hidden: true }
            : { hidden: true },
      },
      { session },
    );
    if (type === ContentType.Review && content.hotelId) {
      await this.recalculateHotel(content.hotelId.toString(), session);
    }
  }

  async remove(type: ContentType, id: string, session: ClientSession) {
    const content = await this.content(type, id, session);
    if (type === ContentType.Itinerary) {
      const raw = await this.collection(ContentType.Itinerary).findOne(
        { _id: content._id },
        { session, projection: { 'days.activities._id': 1 } },
      );
      const embeddedActivities =
        (
          raw?.days as
            | Array<{
                activities?: Array<{ _id: import('mongoose').Types.ObjectId }>;
              }>
            | undefined
        )?.flatMap((day) => day.activities ?? []) ?? [];
      const separateActivities = await this.collection(MediaTarget.Activity)
        .find({ itineraryId: content._id }, { session, projection: { _id: 1 } })
        .toArray();
      const activities = [...embeddedActivities, ...separateActivities];
      await this.store.media.deleteMany(
        {
          targetType: MediaTarget.Activity,
          targetId: { $in: activities.map((activity) => activity._id) },
        },
        { session },
      );
      for (const collection of [
        'activities',
        'itinerary_days',
        'budgets',
        'transport_costs',
      ]) {
        await this.store.connection
          .collection(collection)
          .deleteMany({ itineraryId: content._id }, { session });
      }
    }
    if (
      type === ContentType.Review &&
      (content as Content & { isDeleted?: boolean }).isDeleted !== undefined
    ) {
      await this.collection(type).updateOne(
        { _id: content._id },
        { $set: { isDeleted: true } },
        { session },
      );
    } else {
      await this.collection(type).deleteOne({ _id: content._id }, { session });
    }
    if (type === ContentType.Review && content.hotelId) {
      await this.recalculateHotel(content.hotelId.toString(), session);
    }
  }

  async recalculateHotel(hotelId: string, session: ClientSession) {
    const hotels = this.collection(MediaTarget.Hotel);
    await hotels.updateOne(
      { _id: objectId(hotelId) },
      { $inc: { communityVersion: 1 } },
      { session },
    );
    const [summary] = await this.collection(ContentType.Review)
      .aggregate(
        [
          {
            $match: {
              hotelId: objectId(hotelId),
              hidden: { $ne: true },
              isHidden: { $ne: true },
              isDeleted: { $ne: true },
            },
          },
          {
            $group: {
              _id: null,
              averageRating: { $avg: '$rating' },
              ratingCount: { $sum: 1 },
            },
          },
        ],
        { session },
      )
      .toArray();
    await hotels.updateOne(
      { _id: objectId(hotelId) },
      {
        $set: {
          averageRating: summary?.averageRating ?? 0,
          ratingCount: summary?.ratingCount ?? 0,
        },
      },
      { session },
    );
  }
}
