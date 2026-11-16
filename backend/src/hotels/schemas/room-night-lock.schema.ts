import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type RoomNightLockDocument = HydratedDocument<RoomNightLock>;

export enum RoomLockKind {
  HOLD = 'HOLD',
  BOOKING = 'BOOKING',
  BLOCK = 'BLOCK',
}

/**
 * HTL-16 / HTL-18: one document per room per occupied night.
 *
 * The unique index { roomId, date } is what makes double booking impossible:
 * two concurrent requests can both pass an availability SELECT, but only one
 * can INSERT the night. The insert happens inside a MongoDB transaction with
 * the reservation, so a multi-room reservation succeeds or fails as a whole.
 *
 * kind=HOLD    -> expiresAt in the future (10-minute payment hold)
 * kind=BOOKING -> expiresAt null (confirmed reservation, kept permanently)
 * kind=BLOCK   -> expiresAt null, sourceId points to a moderator block
 */
@Schema({ collection: 'room_night_locks', timestamps: true })
export class RoomNightLock {
  @Prop({ required: true, type: String, match: /^\d{4}-\d{2}-\d{2}$/ })
  date: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Hotel', required: true, index: true })
  hotelId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Room', required: true, index: true })
  roomId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'HotelBooking', default: null, index: true })
  bookingId?: Types.ObjectId | null;

  /** Set for kind=BLOCK: the room_availability_blocks document that owns it. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'RoomAvailability', default: null, index: true })
  sourceId?: Types.ObjectId | null;

  @Prop({
    required: true,
    type: String,
    enum: Object.values(RoomLockKind),
    default: RoomLockKind.HOLD,
  })
  kind: RoomLockKind;

  @Prop({ type: Date, default: null })
  expiresAt?: Date | null;
}

export const RoomNightLockSchema = SchemaFactory.createForClass(RoomNightLock);

RoomNightLockSchema.index({ roomId: 1, date: 1 }, { unique: true });
RoomNightLockSchema.index({ expiresAt: 1 });
