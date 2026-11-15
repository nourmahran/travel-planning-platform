
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';

import {
  BUDGET_CATEGORIES,
  DEFAULT_VISIBILITY,
  ITINERARY_LIMITS,
  ITINERARY_VISIBILITIES,
} from '../itinerary.constants';
import type { BudgetCategory, ItineraryVisibility } from '../itinerary.constants';

@Schema({ _id: true })
export class ActivityImage {
  @Prop({ required: true, trim: true })
  url: string;

  @Prop({ trim: true })
  mimeType?: string;

  @Prop()
  sizeBytes?: number;
}

export const ActivityImageSchema = SchemaFactory.createForClass(ActivityImage);

@Schema({ _id: true })
export class Activity {
  @Prop({ required: true, trim: true, maxlength: ITINERARY_LIMITS.activityTitleMaxLength })
  title: string;

  @Prop({ trim: true })
  attractionId?: string;

  @Prop({ trim: true })
  startTime?: string;

  @Prop()
  durationMinutes?: number;

  @Prop({ trim: true, maxlength: ITINERARY_LIMITS.noteMaxLength })
  notes?: string;

  @Prop({ min: 0 })
  cost?: number;

  @Prop({ type: [ActivityImageSchema], default: [] })
  images: ActivityImage[];
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);

@Schema({ _id: true })
export class BudgetEntry {
  @Prop({ type: String, enum: BUDGET_CATEGORIES, required: true })
  category: BudgetCategory;

  @Prop({ required: true, min: 0 })
  amount: number;

  /**
   * ITN-14: the currency the amount was entered in. Absent on entries written
   * before the field existed, which are read as the itinerary currency.
   */
  @Prop({ trim: true, uppercase: true, maxlength: 3 })
  currency?: string;

  @Prop({ trim: true, maxlength: ITINERARY_LIMITS.noteMaxLength })
  note?: string;
}

export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);

@Schema({ _id: true })
export class Day {
  @Prop({ required: true, min: 1 })
  dayNumber: number;

  @Prop({ required: true })
  date: string;

  @Prop({ required: true })
  cityId: string;

  @Prop({ trim: true, maxlength: ITINERARY_LIMITS.noteMaxLength })
  notes?: string;

  @Prop({ type: [ActivitySchema], default: [] })
  activities: Activity[];

  @Prop({ type: [BudgetEntrySchema], default: [] })
  budgets: BudgetEntry[];
}

export const DaySchema = SchemaFactory.createForClass(Day);

@Schema({ _id: true })
export class TransportCost {
  @Prop({ required: true, trim: true, maxlength: 40 })
  mode: string;

  @Prop({ required: true })
  fromCityId: string;

  @Prop({ required: true })
  toCityId: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  /** ITN-16: the currency the amount was entered in. Absent means the itinerary currency. */
  @Prop({ trim: true, uppercase: true, maxlength: 3 })
  currency?: string;

  @Prop()
  date?: string;

  @Prop({ trim: true, maxlength: ITINERARY_LIMITS.noteMaxLength })
  note?: string;
}

export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);

@Schema({ _id: true })
export class ClonedFrom {
  @Prop({ type: Types.ObjectId, required: true })
  itineraryId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true })
  authorName: string;

  @Prop({ required: true })
  clonedAt: Date;
}

export const ClonedFromSchema = SchemaFactory.createForClass(ClonedFrom);

@Schema({ timestamps: true })
export class Itinerary {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: ITINERARY_LIMITS.titleMaxLength })
  title: string;

  @Prop({ type: [String], required: true })
  countries: string[];

  @Prop({ required: true })
  startDate: string;

  @Prop({ required: true, uppercase: true })
  currency: string;

  @Prop({ type: String, enum: ITINERARY_VISIBILITIES, default: DEFAULT_VISIBILITY })
  visibility: ItineraryVisibility;

  @Prop({ default: false })
  isHidden: boolean;

  @Prop({ type: [DaySchema], default: [] })
  days: Day[];

  @Prop({ type: [TransportCostSchema], default: [] })
  transportCosts: TransportCost[];

  @Prop({ type: ClonedFromSchema })
  clonedFrom?: ClonedFrom;

  @Prop({ default: 0, min: 0 })
  cloneCount: number;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

ItinerarySchema.index({ ownerId: 1, updatedAt: -1 });
ItinerarySchema.index({ visibility: 1, isHidden: 1, updatedAt: -1 });
ItinerarySchema.index({ countries: 1 });
ItinerarySchema.index({ 'days.activities._id': 1 });
ItinerarySchema.index({ 'days.budgets._id': 1 });
ItinerarySchema.index({ 'transportCosts._id': 1 });

export type ItineraryDocument = HydratedDocument<Itinerary> & {
  createdAt: Date;
  updatedAt: Date;
};
