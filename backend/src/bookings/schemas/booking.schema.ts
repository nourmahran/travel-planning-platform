
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BookingDocument = HydratedDocument<Booking>;

export enum BookingStatus {
  PENDING = 'Pending',
  CONFIRMED = 'Confirmed',
  CANCELLED = 'Cancelled',
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
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  userId: string;

  @Prop({ required: true, enum: Object.values(BookingStatus), default: BookingStatus.PENDING })
  status: BookingStatus;

  @Prop({ required: true })
  cabinClass: string;

  @Prop({ type: [BookingPassengerSchema], required: true })
  passengers: BookingPassenger[];

  @Prop({ required: true, min: 0 })
  totalPrice: number;

  @Prop()
  confirmedAt?: Date;

  @Prop()
  cancelledAt?: Date;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);
