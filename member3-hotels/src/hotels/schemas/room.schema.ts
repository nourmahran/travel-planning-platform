import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { FALLBACK_CURRENCY } from '../../shared/constants';
import { HotelImage } from './hotel.schema';

export type RoomDocument = HydratedDocument<Room> & { createdAt: Date; updatedAt: Date };

export const BED_TYPES = ['single', 'double', 'queen', 'king', 'twin', 'sofa_bed'] as const;
export type BedType = (typeof BED_TYPES)[number];

/**
 * HTL-03..HTL-06: an individually bookable physical room.
 * Each document represents one room (not a room type), which is what makes
 * per-room availability and "one review per completed reservation" possible.
 */
@Schema({ collection: 'rooms', timestamps: true })
export class Room {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Hotel', required: true, index: true })
  hotelId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 20 })
  roomNumber: string;

  @Prop({ required: true, trim: true, minlength: 2, maxlength: 120 })
  name: string;

  @Prop({ trim: true, maxlength: 2000 })
  description?: string;

  @Prop({ required: true, type: String, enum: BED_TYPES, default: 'double' })
  bedType: BedType;

  @Prop({ required: true, type: Number, min: 1, max: 10, default: 1 })
  bedCount: number;

  /** Occupancy rules used by the availability search and booking validation. */
  @Prop({ required: true, type: Number, min: 1, max: 10, default: 2 })
  maxAdults: number;

  @Prop({ required: true, type: Number, min: 0, max: 10, default: 0 })
  maxChildren: number;

  /** Nightly price in minor units (cents) of the single platform currency. */
  @Prop({ required: true, type: Number, min: 0 })
  basePricePerNightCents: number;

  @Prop({ required: true, type: String, uppercase: true, trim: true, default: FALLBACK_CURRENCY })
  currency: string;

  @Prop({ type: Number, min: 1, max: 1000, default: null })
  sizeSqm?: number | null;

  @Prop({ type: [String], default: [] })
  amenities: string[];

  @Prop({ type: [HotelImage], default: [] })
  images: HotelImage[];

  @Prop({ type: Number, min: -5, max: 200, default: null })
  floor?: number | null;

  /** HTL-07: deactivated rooms keep their history but cannot be booked. */
  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;
}

export const RoomSchema = SchemaFactory.createForClass(Room);

RoomSchema.index({ hotelId: 1, roomNumber: 1 }, { unique: true });
RoomSchema.index({ hotelId: 1, isActive: 1, basePricePerNightCents: 1 });
