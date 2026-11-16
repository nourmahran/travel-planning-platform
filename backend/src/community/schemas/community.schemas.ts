import { Schema, Types } from 'mongoose';
import {
  BaseRecord,
  ContentType,
  MediaTarget,
  NotificationType,
  PostStatus,
  ReportStatus,
} from '../types';

export interface PostRecord extends BaseRecord {
  authorId: Types.ObjectId;
  itineraryId?: Types.ObjectId;
  title: string;
  body: string;
  tags: string[];
  status: PostStatus;
  hidden: boolean;
  publishedAt?: Date;
  communityVersion: number;
}

export interface CommentRecord extends BaseRecord {
  postId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  hidden: boolean;
}

export interface LikeRecord extends BaseRecord {
  postId: Types.ObjectId;
  userId: Types.ObjectId;
}

export interface MediaRecord extends BaseRecord {
  targetType: MediaTarget;
  targetId: Types.ObjectId;
  uploaderId: Types.ObjectId;
  mimeType: 'image/jpeg' | 'image/png';
  size: number;
  data: Buffer;
}

export interface ReportRecord extends BaseRecord {
  reporterId: Types.ObjectId;
  targetType: ContentType;
  targetId: Types.ObjectId;
  reason: string;
  status: ReportStatus;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  resolutionNote?: string;
}

export interface NotificationRecord extends BaseRecord {
  recipientId: Types.ObjectId;
  eventId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  readAt?: Date;
}

export interface AuditRecord extends BaseRecord {
  actorId: Types.ObjectId;
  action: string;
  targetType: string;
  targetId: Types.ObjectId;
  details: Record<string, unknown>;
}

export interface SessionRecord extends BaseRecord {
  userId: Types.ObjectId;
  tokenHash: string;
  csrfHash: string;
  lastSeenAt: Date;
  expiresAt: Date;
}

const id = Schema.Types.ObjectId;
const timestamps = { timestamps: true, versionKey: false } as const;

export const PostSchema = new Schema<PostRecord>(
  {
    authorId: { type: id, required: true, index: true },
    itineraryId: { type: id },
    title: {
      type: String,
      required: true,
      trim: true,
      validate: (value: string) => Array.from(value).length <= 300,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      validate: (value: string) => Array.from(value).length <= 100000,
    },
    tags: {
      type: [String],
      default: [],
      validate: (tags: string[]) =>
        tags.length <= 5 &&
        new Set(tags).size === tags.length &&
        tags.every(
          (tag) => tag.trim().length > 0 && Array.from(tag).length <= 30,
        ),
    },
    status: { type: String, enum: PostStatus, default: PostStatus.Draft },
    hidden: { type: Boolean, default: false },
    publishedAt: Date,
    communityVersion: { type: Number, default: 0 },
  },
  timestamps,
);
PostSchema.index({ status: 1, hidden: 1, publishedAt: -1 });
PostSchema.index({ tags: 1, status: 1 });

export const CommentSchema = new Schema<CommentRecord>(
  {
    postId: { type: id, required: true },
    authorId: { type: id, required: true },
    body: {
      type: String,
      required: true,
      trim: true,
      validate: (value: string) => Array.from(value).length <= 500,
    },
    hidden: { type: Boolean, default: false },
  },
  timestamps,
);
CommentSchema.index({ postId: 1, hidden: 1, createdAt: 1, _id: 1 });

export const LikeSchema = new Schema<LikeRecord>(
  {
    postId: { type: id, required: true },
    userId: { type: id, required: true },
  },
  timestamps,
);
LikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

export const MediaSchema = new Schema<MediaRecord>(
  {
    targetType: { type: String, enum: MediaTarget, required: true },
    targetId: { type: id, required: true },
    uploaderId: { type: id, required: true },
    mimeType: {
      type: String,
      enum: ['image/jpeg', 'image/png'],
      required: true,
    },
    size: { type: Number, required: true, max: 5 * 1024 * 1024 },
    data: { type: Buffer, required: true, select: false },
  },
  timestamps,
);
MediaSchema.index({ targetType: 1, targetId: 1 });

export const ReportSchema = new Schema<ReportRecord>(
  {
    reporterId: { type: id, required: true },
    targetType: { type: String, enum: ContentType, required: true },
    targetId: { type: id, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    status: { type: String, enum: ReportStatus, default: ReportStatus.Open },
    resolvedBy: id,
    resolvedAt: Date,
    resolutionNote: String,
  },
  timestamps,
);
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
ReportSchema.index({ status: 1, createdAt: 1 });

export const NotificationSchema = new Schema<NotificationRecord>(
  {
    recipientId: { type: id, required: true },
    eventId: { type: String, required: true, maxlength: 200 },
    type: { type: String, enum: NotificationType, required: true },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 2000 },
    link: { type: String, maxlength: 500 },
    readAt: Date,
  },
  timestamps,
);
NotificationSchema.index({ recipientId: 1, eventId: 1 }, { unique: true });
NotificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });

export const AuditSchema = new Schema<AuditRecord>(
  {
    actorId: { type: id, required: true, immutable: true },
    action: { type: String, required: true, immutable: true },
    targetType: { type: String, required: true, immutable: true },
    targetId: { type: id, required: true, immutable: true },
    details: { type: Schema.Types.Mixed, default: {}, immutable: true },
  },
  timestamps,
);
AuditSchema.index({ createdAt: -1, _id: -1 });
AuditSchema.index({ actorId: 1, action: 1 });

export const SessionSchema = new Schema<SessionRecord>(
  {
    userId: { type: id, required: true },
    tokenHash: { type: String, required: true, unique: true },
    csrfHash: { type: String, required: true },
    lastSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  timestamps,
);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const communityModels = [
  { name: 'CommunityPost', schema: PostSchema, collection: 'posts' },
  { name: 'CommunityComment', schema: CommentSchema, collection: 'comments' },
  { name: 'CommunityLike', schema: LikeSchema, collection: 'likes' },
  { name: 'CommunityMedia', schema: MediaSchema, collection: 'media' },
  { name: 'CommunityReport', schema: ReportSchema, collection: 'reports' },
  {
    name: 'CommunityNotification',
    schema: NotificationSchema,
    collection: 'notifications',
  },
  { name: 'CommunityAudit', schema: AuditSchema, collection: 'audit_logs' },
  {
    name: 'CommunitySession',
    schema: SessionSchema,
    collection: 'community_sessions',
  },
];
