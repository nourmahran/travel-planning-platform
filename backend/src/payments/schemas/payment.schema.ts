import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BookingType } from '../../common/booking';

export enum PaymentStatus {
  Pending = 'Pending',
  Succeeded = 'Succeeded',
  Failed = 'Failed',
  Cancelled = 'Cancelled',
}

/**
 * PAY-01: "Only the Stripe payment ID, amount, currency and status are stored."
 * No card data and no client secret are ever saved here.
 */
@Schema({ collection: 'payments', timestamps: true })
export class Payment {
  @Prop({ type: String, enum: Object.values(BookingType), required: true })
  bookingType: BookingType;

  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  bookingId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  stripePaymentIntentId: string;

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

  /** Platform currency, lowercase ISO (PAY-04). */
  @Prop({ type: String, required: true, lowercase: true })
  currency: string;

  @Prop({
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.Pending,
  })
  status: PaymentStatus;

  /** Short Stripe message (e.g. "Your card was declined."). Never card info. */
  @Prop({ type: String })
  failureMessage?: string;

  /** How many times the user tried to pay with this PaymentIntent. */
  @Prop({ type: Number, default: 1, min: 1 })
  attempts: number;

  @Prop({ type: Date })
  succeededAt?: Date;

  @Prop({ type: Date })
  cancelledAt?: Date;

  /** Set if this charge was a duplicate of an already-paid booking and was refunded automatically. */
  @Prop({ type: String })
  duplicateRefundId?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.index({ stripePaymentIntentId: 1 }, { unique: true });
PaymentSchema.index({ bookingType: 1, bookingId: 1, status: 1 });
// The database itself guarantees at most ONE successful payment per booking.
PaymentSchema.index(
  { bookingType: 1, bookingId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: PaymentStatus.Succeeded },
    name: 'one_succeeded_payment_per_booking',
  },
);
