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
    return this.store.connection.collection(this.accountsCollection).findOne(
      { _id: objectId(id) },
      {
        session,
        projection: {
          name: 1,
          role: 1,
          status: 1,
          createdAt: 1,
          mustChangePassword: 1,
          assignedHotelId: 1,
          assignedAirlineId: 1,
        },
      },
    ) as Promise<Account | null>;
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
    const filter = {
      authorId: objectId(authorId),
      visibility: 'Public',
      hidden: { $ne: true },
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
    const record = await this.collection(type).findOne(
      { _id: objectId(id) },
      { session },
    );
    if (!record) throw new NotFoundException('Content not found');
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
      { $set: { hidden: true } },
      { session },
    );
    if (type === ContentType.Review && content.hotelId) {
      await this.recalculateHotel(content.hotelId.toString(), session);
    }
  }

  async remove(type: ContentType, id: string, session: ClientSession) {
    const content = await this.content(type, id, session);
    if (type === ContentType.Itinerary) {
      const activities = await this.collection(MediaTarget.Activity)
        .find({ itineraryId: content._id }, { session, projection: { _id: 1 } })
        .toArray();
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
    await this.collection(type).deleteOne({ _id: content._id }, { session });
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
          { $match: { hotelId: objectId(hotelId), hidden: { $ne: true } } },
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
