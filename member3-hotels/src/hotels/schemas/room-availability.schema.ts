import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type RoomAvailabilityDocument = HydratedDocument<RoomAvailability> & {
  createdAt: Date;
  updatedAt: Date;
};

/**
 * HTL-04..HTL-06: a date range during which a room cannot be sold
 * (maintenance, owner stay, external channel, ...). Dates are inclusive and
 * stored as YYYY-MM-DD strings.
 *
 * Reservations are NOT stored here. They live in `room_night_locks`, which is
 * the concurrency-safe source of truth for booked/held nights.
 */
@Schema({ collection: 'room_availability_blocks', timestamps: true })
export class RoomAvailability {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Hotel', required: true, index: true })
  hotelId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Room', required: true, index: true })
  roomId: Types.ObjectId;

  @Prop({ required: true, type: String, match: /^\d{4}-\d{2}-\d{2}$/ })
  startDate: string;

  @Prop({ required: true, type: String, match: /^\d{4}-\d{2}-\d{2}$/ })
  endDate: string;

  @Prop({ trim: true, maxlength: 300 })
  reason?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;
}

export const RoomAvailabilitySchema = SchemaFactory.createForClass(RoomAvailability);

RoomAvailabilitySchema.index({ roomId: 1, startDate: 1, endDate: 1 });
RoomAvailabilitySchema.index({ hotelId: 1, startDate: 1 });
