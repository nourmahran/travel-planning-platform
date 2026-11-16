import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BookingType } from '../../common/booking';
import { Payment } from './payment.schema';

/** PAY-03 statuses shown on the booking details. */
export enum RefundStatus {
  Pending = 'Pending',
  Refunded = 'Refunded',
  Failed = 'Failed',
}

export enum RefundReason {
  FlightChange = 'FlightChange',
  /** User cancelled: refund % from the provider's tiers (FLT-26, HTL-21). */
  UserCancellation = 'UserCancellation',
  /** Airline/hotel cancelled: always 100% (FLT-06). */
  ProviderCancellation = 'ProviderCancellation',
  /** Payment succeeded after the hold expired: always 100%. */
  LatePayment = 'LatePayment',
}

@Schema({ collection: 'refunds', timestamps: true })
export class Refund {
  @Prop({ type: SchemaTypes.ObjectId, ref: Payment.name, required: true })
  paymentId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(BookingType), required: true })
  bookingType: BookingType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  /** Set after Stripe accepts the refund. */
  @Prop({ type: String })
  stripeRefundId?: string;

  /** Minor units (cents), integer. */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'amount must be an integer (minor units)',
    },
  })
  amount: number;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  percent: number;

  @Prop({ type: String, required: true, lowercase: true })
  currency: string;

  @Prop({ type: String, enum: Object.values(RefundReason), required: true })
  reason: RefundReason;

  @Prop({
    type: String,
    enum: Object.values(RefundStatus),
    default: RefundStatus.Pending,
  })
  status: RefundStatus;

  @Prop({ type: String })
  failureMessage?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export type RefundDocument = HydratedDocument<Refund>;
export const RefundSchema = SchemaFactory.createForClass(Refund);

RefundSchema.index({ stripeRefundId: 1 }, { unique: true, sparse: true });
// Cancellations are whole-booking only, so a booking gets at most one refund.
RefundSchema.index({ bookingType: 1, bookingId: 1 }, { unique: true });
