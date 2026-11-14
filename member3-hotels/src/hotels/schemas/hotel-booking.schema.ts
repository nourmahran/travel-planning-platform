import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { CancellationTier } from './hotel.schema';

export type HotelBookingDocument = HydratedDocument<HotelBooking> & {
  createdAt: Date;
  updatedAt: Date;
};

/** Reservation lifecycle (checked result of Member 4's booking-state machine). */
export enum HotelBookingStatus {
  /** HTL-16: inventory is held for 10 minutes while the user pays. */
  HELD = 'HELD',
  /** HTL-19: payment verified; rooms are guaranteed for the stay. */
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  /** HTL-22: automatically set after the check-out date. */
  COMPLETED = 'COMPLETED',
  /** The 10-minute hold elapsed before a verified payment. */
  EXPIRED = 'EXPIRED',
}

export const ACTIVE_BOOKING_STATUSES: HotelBookingStatus[] = [
  HotelBookingStatus.HELD,
  HotelBookingStatus.CONFIRMED,
];

export enum RefundStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
}

export enum CancelledBy {
  USER = 'USER',
  ADMIN = 'ADMIN',
  MODERATOR = 'MODERATOR',
  SYSTEM = 'SYSTEM',
}

@Schema({ _id: false })
export class BookingGuest {
  @Prop({ required: true, trim: true, maxlength: 60 })
  firstName: string;

  @Prop({ required: true, trim: true, maxlength: 60 })
  lastName: string;

  /** Missing age is treated as an adult (18+). */
  @Prop({ type: Number, min: 0, max: 120, default: null })
  age?: number | null;
}

@Schema({ _id: false })
export class BookedRoom {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Room', required: true })
  roomId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  roomNumber: string;

  @Prop({ required: true, trim: true })
  roomName: string;

  /** Snapshot of the price so later room edits never change a reservation. */
  @Prop({ required: true, type: Number, min: 0 })
  pricePerNightCents: number;

  @Prop({ required: true, type: Number, min: 1 })
  nights: number;

  @Prop({ type: [BookingGuest], default: [] })
  guests: BookingGuest[];

  @Prop({ required: true, type: Number, min: 0 })
  subtotalCents: number;

  @Prop({ trim: true, maxlength: 300 })
  specialRequests?: string;
}

@Schema({ _id: false })
export class RefundInfo {
  @Prop({ required: true, type: Number, min: 0 })
  amountCents: number;

  @Prop({ required: true, type: Number, min: 0, max: 100 })
  percent: number;

  @Prop({ required: true, type: String, enum: Object.values(RefundStatus), default: RefundStatus.NONE })
  status: RefundStatus;

  /** Stripe Refund id, filled by Member 4's payment module. */
  @Prop({ type: String, default: null })
  providerRefundId?: string | null;

  @Prop({ type: Date, default: null })
  requestedAt?: Date | null;

  @Prop({ type: Date, default: null })
  processedAt?: Date | null;

  @Prop({ type: String, trim: true, maxlength: 500, default: null })
  failureReason?: string | null;
}

@Schema({ _id: false })
export class BookingCancellation {
  @Prop({ required: true, type: String, enum: Object.values(CancelledBy) })
  cancelledBy: CancelledBy;

  @Prop({ trim: true, maxlength: 300 })
  reason?: string;

  @Prop({ required: true, type: Date })
  cancelledAt: Date;

  /** Tier that was applied, kept for auditing and refund recalculation. */
  @Prop({ type: Number, min: 0, default: 0 })
  daysBeforeCheckIn: number;

  @Prop({ type: RefundInfo, required: true })
  refund: RefundInfo;
}

/** Copy of the hotel policy at booking time (PAY-02 / HTL-10). */
@Schema({ _id: false })
export class BookingPolicySnapshot {
  @Prop({ required: true, type: String })
  checkInTime: string;

  @Prop({ required: true, type: String })
  checkOutTime: string;

  @Prop({ type: [CancellationTier], default: [] })
  cancellationTiers: CancellationTier[];

  @Prop({ required: true, type: Date })
  capturedAt: Date;
}

@Schema({ collection: 'hotel_bookings', timestamps: true })
export class HotelBooking {
  /** Public reservation reference, unique (HTL-20). */
  @Prop({ required: true, unique: true, trim: true, uppercase: true })
  reference: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Hotel', required: true, index: true })
  hotelId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  hotelName: string;

  @Prop({ type: [BookedRoom], required: true })
  rooms: BookedRoom[];

  @Prop({ required: true, type: String, match: /^\d{4}-\d{2}-\d{2}$/ })
  checkIn: string;

  @Prop({ required: true, type: String, match: /^\d{4}-\d{2}-\d{2}$/ })
  checkOut: string;

  @Prop({ required: true, type: Number, min: 1 })
  nights: number;

  @Prop({ required: true, type: Number, min: 1 })
  guestCount: number;

  /** HTL-17: sum of the room line subtotals, in minor units. */
  @Prop({ required: true, type: Number, min: 0 })
  totalAmountCents: number;

  @Prop({ required: true, type: String, uppercase: true, trim: true })
  currency: string;

  @Prop({
    required: true,
    type: String,
    enum: Object.values(HotelBookingStatus),
    default: HotelBookingStatus.HELD,
    index: true,
  })
  status: HotelBookingStatus;

  @Prop({ type: Date, default: null })
  holdExpiresAt?: Date | null;

  @Prop({ type: Date, default: null })
  confirmedAt?: Date | null;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;

  @Prop({ type: Date, default: null })
  expiredAt?: Date | null;

  @Prop({ type: BookingCancellation, default: null })
  cancellation?: BookingCancellation | null;

  /**
   * PAY-02: timestamp of policy acceptance. Member 4's generic
   * /api/bookings/:type/:id/accept-policies endpoint should call
   * HotelBookingsService.recordPolicyAcceptance() so payment stays blocked
   * until this is set.
   */
  @Prop({ type: Date, default: null })
  policiesAcceptedAt?: Date | null;

  @Prop({ type: BookingPolicySnapshot, required: true })
  policySnapshot: BookingPolicySnapshot;

  /** Stripe PaymentIntent id, owned by Member 4. */
  @Prop({ type: String, default: null })
  paymentId?: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Review', default: null })
  reviewId?: Types.ObjectId | null;

  @Prop({ trim: true, maxlength: 500 })
  notes?: string;
}

export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);

HotelBookingSchema.index({ userId: 1, createdAt: -1 });
HotelBookingSchema.index({ hotelId: 1, checkIn: 1 });
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1 });
HotelBookingSchema.index({ hotelId: 1, status: 1, checkIn: 1 });
