import { Types } from 'mongoose';

export enum Role {
  User = 'user',
  Admin = 'admin',
  HotelModerator = 'hotel_moderator',
  AirlineModerator = 'airline_moderator',
}

export enum PostStatus {
  Draft = 'Draft',
  Published = 'Published',
}

export enum ContentType {
  Post = 'post',
  Comment = 'comment',
  Review = 'review',
  Itinerary = 'itinerary',
}

export enum MediaTarget {
  Post = 'post',
  Activity = 'activity',
  Hotel = 'hotel',
  Airline = 'airline',
}

export enum ReportStatus {
  Open = 'Open',
  Dismissed = 'Dismissed',
  Hidden = 'Hidden',
  Deleted = 'Deleted',
}

export enum ModerationAction {
  Dismiss = 'dismiss',
  Hide = 'hide',
  Delete = 'delete',
}

export enum NotificationType {
  BookingConfirmed = 'booking.confirmed',
  BookingCancelled = 'booking.cancelled',
  BookingUpdated = 'booking.updated',
  PaymentFailed = 'payment.failed',
  RefundUpdated = 'refund.updated',
  FlightScheduleChanged = 'flight.schedule_changed',
  AccountSuspended = 'account.suspended',
  ProviderSuspended = 'provider.suspended',
}

export interface Actor {
  id: string;
  name: string;
  role: Role;
  assignedHotelId?: string;
  assignedAirlineId?: string;
}

export interface Account {
  _id: Types.ObjectId;
  name: string;
  role: Role;
  status: 'active' | 'suspended' | 'deactivated';
  createdAt: Date;
  mustChangePassword?: boolean;
  assignedHotelId?: Types.ObjectId;
  assignedAirlineId?: Types.ObjectId;
}

export interface Content {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  hidden?: boolean;
  status?: PostStatus;
  visibility?: 'Public' | 'Private';
  postId?: Types.ObjectId;
  itineraryId?: Types.ObjectId;
  hotelId?: Types.ObjectId;
}

export interface BaseRecord {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const PAGE_SIZE = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_LIMITS: Record<MediaTarget, number> = {
  post: 5,
  activity: 5,
  hotel: 5,
  airline: 1,
};

export function objectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value);
}

export function pageResult<T>(items: T[], total: number, page: number) {
  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil(total / PAGE_SIZE),
    message: items.length ? undefined : 'No results found',
  };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
}
