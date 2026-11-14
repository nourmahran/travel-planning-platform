import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import {
  AuditRecord,
  CommentRecord,
  LikeRecord,
  MediaRecord,
  NotificationRecord,
  PostRecord,
  ReportRecord,
  SessionRecord,
} from './schemas/community.schemas';

@Injectable()
export class CommunityStore implements OnModuleInit {
  constructor(
    @InjectConnection() readonly connection: Connection,
    @InjectModel('CommunityPost') readonly posts: Model<PostRecord>,
    @InjectModel('CommunityComment') readonly comments: Model<CommentRecord>,
    @InjectModel('CommunityLike') readonly likes: Model<LikeRecord>,
    @InjectModel('CommunityMedia') readonly media: Model<MediaRecord>,
    @InjectModel('CommunityReport') readonly reports: Model<ReportRecord>,
    @InjectModel('CommunityNotification')
    readonly notifications: Model<NotificationRecord>,
    @InjectModel('CommunityAudit') readonly audits: Model<AuditRecord>,
    @InjectModel('CommunitySession') readonly sessions: Model<SessionRecord>,
  ) {}

  async onModuleInit() {
    for (const model of [
      this.posts,
      this.comments,
      this.likes,
      this.media,
      this.reports,
      this.notifications,
      this.audits,
      this.sessions,
    ]) {
      await model.init();
    }
  }

  async transaction<T>(
    operation: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      const result = await session.withTransaction(() => operation(session));
      return result as T;
    } finally {
      await session.endSession();
    }
  }
}
