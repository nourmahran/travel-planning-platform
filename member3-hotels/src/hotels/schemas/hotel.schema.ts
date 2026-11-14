import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { MAX_HOTEL_IMAGES } from '../../shared/constants';

export type HotelDocument = HydratedDocument<Hotel> & { createdAt: Date; updatedAt: Date };

@Schema({ _id: false })
export class HotelImage {
  @Prop({ required: true, trim: true, maxlength: 2048 })
  url: string;

  @Prop({ trim: true, maxlength: 200 })
  caption?: string;
}

@Schema({ _id: false })
export class HotelLocation {
  @Prop({ required: true, trim: true, maxlength: 120 })
  city: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  country: string;

  @Prop({ required: true, trim: true, maxlength: 300 })
  address: string;

  @Prop({ type: Number, min: -90, max: 90, default: null })
  latitude?: number | null;

  @Prop({ type: Number, min: -180, max: 180, default: null })
  longitude?: number | null;
}

@Schema({ _id: false })
export class CancellationTier {
  @Prop({ required: true, min: 0, max: 365 })
  minDaysBeforeCheckIn: number;

  @Prop({ required: true, min: 0, max: 100 })
  refundPercent: number;

  @Prop({ trim: true, maxlength: 200 })
  description?: string;
}

/**
 * HTL-09 check-in/check-out rules and HTL-10 cancellation tiers.
 * Hotel moderators replace the whole policy through PUT /api/hotels/:id/policies.
 */
@Schema({ _id: false })
export class HotelPolicies {
  @Prop({ required: true, default: '14:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  checkInTime: string;

  @Prop({ required: true, default: '12:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  checkOutTime: string;

  @Prop({ type: [CancellationTier], default: [] })
  cancellationTiers: CancellationTier[];

  @Prop({ type: Boolean, default: true })
  childrenAllowed: boolean;

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;
}

export function defaultHotelPolicies(): HotelPolicies {
  return {
    checkInTime: '14:00',
    checkOutTime: '12:00',
    childrenAllowed: true,
    cancellationTiers: [
      { minDaysBeforeCheckIn: 7, refundPercent: 100, description: 'Free cancellation up to 7 days before check-in.' },
      { minDaysBeforeCheckIn: 3, refundPercent: 50, description: '50% refund up to 3 days before check-in.' },
      { minDaysBeforeCheckIn: 0, refundPercent: 0, description: 'No refund for later cancellations.' },
    ],
  };
}

@Schema({ collection: 'hotels', timestamps: true })
export class Hotel {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 120 })
  name: string;

  @Prop({ required: true, trim: true, minlength: 20, maxlength: 5000 })
  description: string;

  @Prop({ type: HotelLocation, required: true })
  location: HotelLocation;

  @Prop({ type: [String], default: [] })
  amenities: string[];

  @Prop({ type: [HotelImage], default: [] })
  images: HotelImage[];

  /** Property class shown as stars (1-5). */
  @Prop({ required: true, type: Number, min: 1, max: 5 })
  starRating: number;

  /** HTL-24: recalculated from visible reviews whenever a review changes. */
  @Prop({ type: Number, min: 0, max: 5, default: 0 })
  averageRating: number;

  @Prop({ type: Number, min: 0, default: 0 })
  reviewCount: number;

  /**
   * HTL-01 / ACC-15: a deactivated hotel is hidden from search and cannot be
   * booked, but existing Confirmed reservations stay valid.
   */
  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  /** The hotel moderator assigned by an administrator. Exactly one hotel each. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  moderatorId?: Types.ObjectId | null;

  @Prop({ trim: true, lowercase: true, maxlength: 254 })
  contactEmail?: string;

  @Prop({ trim: true, maxlength: 30 })
  contactPhone?: string;

  @Prop({ type: HotelPolicies, required: true, default: () => defaultHotelPolicies() })
  policies: HotelPolicies;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);

HotelSchema.index({ name: 1, 'location.city': 1, 'location.country': 1 }, { unique: true });
HotelSchema.index({ 'location.city': 1, isActive: 1 });
HotelSchema.index({ averageRating: -1 });
HotelSchema.index({ amenities: 1 });
HotelSchema.index(
  { moderatorId: 1 },
  { unique: true, partialFilterExpression: { moderatorId: { $type: 'objectId' } } },
);

/** Amenities are stored as lower-case slugs so filters stay predictable. */
export const HOTEL_IMAGE_LIMIT = MAX_HOTEL_IMAGES;
