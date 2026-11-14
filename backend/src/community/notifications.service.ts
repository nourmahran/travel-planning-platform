import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession, isObjectIdOrHexString } from 'mongoose';
import { CommunityStore } from './store';
import { TeamBridge } from './team.bridge';
import { NotificationType, objectId, PAGE_SIZE, pageResult } from './types';

export interface NotificationInput {
  recipientId: string;
  eventId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly store: CommunityStore,
    private readonly bridge: TeamBridge,
  ) {}

  async send(input: NotificationInput, session?: ClientSession) {
    if (
      !isObjectIdOrHexString(input.recipientId) ||
      !Object.values(NotificationType).includes(input.type) ||
      !input.eventId?.trim() ||
      input.eventId.length > 200 ||
      !input.title?.trim() ||
      input.title.length > 200 ||
      !input.message?.trim() ||
      input.message.length > 2000 ||
      (input.link !== undefined &&
        (!/^\/(?!\/)/.test(input.link) || input.link.length > 500))
    )
      throw new BadRequestException('Invalid notification data');
    if (!(await this.bridge.account(input.recipientId, session))) {
      throw new NotFoundException('Notification recipient not found');
    }
    const filter = {
      recipientId: objectId(input.recipientId),
      eventId: input.eventId,
    };
    try {
      return await this.store.notifications
        .findOneAndUpdate(
          filter,
          {
            $setOnInsert: {
              ...filter,
              type: input.type,
              title: input.title,
              message: input.message,
              link: input.link,
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
            runValidators: true,
            session,
          },
        )
        .lean();
    } catch (error) {
      if (!session && (error as { code?: number }).code === 11000) {
        return this.store.notifications.findOne(filter).lean();
      }
      throw error;
    }
  }

  async list(userId: string, page: number) {
    const filter = { recipientId: objectId(userId) };
    const total = await this.store.notifications.countDocuments(filter);
    const items = await this.store.notifications
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean();
    return pageResult(items, total, page);
  }

  async unreadCount(userId: string) {
    return {
      unreadCount: await this.store.notifications.countDocuments({
        recipientId: objectId(userId),
        readAt: { $exists: false },
      }),
    };
  }

  async markRead(userId: string, id: string) {
    const filter = { _id: objectId(id), recipientId: objectId(userId) };
    await this.store.notifications.updateOne(
      { ...filter, readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );
    const notification = await this.store.notifications.findOne(filter).lean();
    if (!notification) throw new NotFoundException('Notification not found');
    return notification;
  }

  async markAllRead(userId: string) {
    const result = await this.store.notifications.updateMany(
      { recipientId: objectId(userId), readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );
    return { markedAsRead: result.modifiedCount };
  }
}
