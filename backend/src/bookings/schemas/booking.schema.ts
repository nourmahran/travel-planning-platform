import { randomUUID } from 'node:crypto';

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

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
  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ required: true, trim: true })
  lastName: string;

  @Prop({ required: true, trim: true })
  passportNumber: string;
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

  @Prop()
  holdExpiresAt?: Date;

  @Prop()
  expiredAt?: Date;

  @Prop()
  confirmedAt?: Date;

  @Prop()
  cancelledAt?: Date;

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
