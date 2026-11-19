import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type ReviewDocument = HydratedDocument<Review> & { createdAt: Date; updatedAt: Date };

export const REVIEW_COMMENT_MIN_LENGTH = 10;
/** HTL-23: optional review text, at most 1000 characters. */
export const REVIEW_COMMENT_MAX_LENGTH = 1000;

@Schema({ _id: false })
export class ReviewReply {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 1000 })
  body: string;

  @Prop({ required: true, type: SchemaTypes.ObjectId, ref: 'User' })
  repliedBy: Types.ObjectId;

  @Prop({ required: true, type: Date })
  repliedAt: Date;
}

/**
 * HTL-23 / HTL-24: one review per completed reservation.
 *
 * `bookingId` is unique, including for soft-deleted reviews, so a user cannot
 * delete and re-submit a review for the same stay. Deleted/hidden reviews stay
 * in the collection for auditing but are excluded from the hotel average.
 */
@Schema({ collection: 'reviews', timestamps: true })
export class Review {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Hotel', required: true, index: true })
  hotelId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'HotelBooking', required: true, unique: true })
  bookingId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, type: Number, min: 1, max: 5 })
  rating: number;

  @Prop({ trim: true, maxlength: 120 })
  title?: string;

  @Prop({
    required: false,
    trim: true,
    minlength: REVIEW_COMMENT_MIN_LENGTH,
    maxlength: REVIEW_COMMENT_MAX_LENGTH,
  })
  comment?: string;

  /** Moderation flag owned by Member 6 / administrators. */
  @Prop({ type: Boolean, default: false, index: true })
  isHidden: boolean;

  @Prop({ type: String, trim: true, maxlength: 500, default: null })
  hiddenReason?: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  isDeleted: boolean;

  /** Optional moderator bonus: the assigned hotel moderator's public reply. */
  @Prop({ type: ReviewReply, default: null })
  moderatorReply?: ReviewReply | null;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

ReviewSchema.index({ hotelId: 1, createdAt: -1 });
ReviewSchema.index({ hotelId: 1, rating: 1 });
