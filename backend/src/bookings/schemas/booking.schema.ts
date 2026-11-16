import { randomUUID } from 'node:crypto';

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { FlightPolicies } from '../../airlines/schemas/airline.schema';

export type BookingDocument = HydratedDocument<Booking>;

export enum BookingStatus {
  PENDING = 'Pending',
  PENDING_PAYMENT = 'Pending Payment',
  CONFIRMED = 'Confirmed',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',
  COMPLETED = 'Completed',
}

@Schema({ _id: false })
export class BookingPassenger {
  @Prop({ type: Number, min: 1 }) seatNumber?: number;
  @Prop({ type: Number, min: 1 }) returnSeatNumber?: number;
  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ required: true, trim: true })
  lastName: string;

  @Prop({ required: true, trim: true })
  passportNumber: string;

  @Prop({ required: true }) dateOfBirth: string;
  @Prop({ required: true, enum: ['adult', 'child', 'infant'] })
  passengerType: string;
  @Prop({ type: [Number], default: [] }) extraBagWeightsKg: number[];
  @Prop({ required: true, min: 0 }) fare: number;
  @Prop({ default: 0, min: 0 }) baggageFee: number;
}

export const BookingPassengerSchema =
  SchemaFactory.createForClass(BookingPassenger);

@Schema({ timestamps: true })
export class Booking {
  @Prop({ default: () => randomUUID().toUpperCase(), immutable: true })
  reference: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'Flight',
    required: true,
  })
  flightId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Flight' })
  returnFlightId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  userId: string;

  @Prop({
    required: true,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PENDING_PAYMENT,
  })
  status: BookingStatus;

  @Prop({ required: true })
  cabinClass: string;

  @Prop({
    type: [BookingPassengerSchema],
    required: true,
  })
  passengers: BookingPassenger[];

  @Prop({ required: true, min: 0 })
  totalPrice: number;

  @Prop({ min: 0 })
  seatCount?: number;

  @Prop({ min: 0 })
  returnSeatCount?: number;

  @Prop()
  policiesAcceptedAt?: Date;

  @Prop({ type: Object })
  policySnapshot?: FlightPolicies;

  @Prop()
  holdExpiresAt?: Date;

  @Prop()
  expiredAt?: Date;

  @Prop()
  confirmedAt?: Date;

  @Prop()
  cancelledAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Flight' })
  providerCancelledFlightId?: Types.ObjectId;

  @Prop({ default: false })
  refundDispatchPending?: boolean;

  @Prop({ enum: ['UserCancellation', 'ProviderCancellation'] })
  refundDispatchReason?: string;

  @Prop()
  completedAt?: Date;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

BookingSchema.index({
  status: 1,
  holdExpiresAt: 1,
});

// Sparse preserves existing bookings until an explicit reference backfill.
BookingSchema.index({ reference: 1 }, { unique: true, sparse: true });
