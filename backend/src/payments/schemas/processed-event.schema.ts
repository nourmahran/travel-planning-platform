import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Stripe may deliver the same webhook event more than once. Before handling an
 * event we insert its ID here; the unique index makes a second insert fail
 * (duplicate key 11000), so each event is processed exactly once.
 * Rows are removed automatically after 30 days (TTL index).
 */
@Schema({ collection: 'processed_stripe_events', timestamps: false })
export class ProcessedEvent {
  @Prop({ type: String, required: true })
  eventId: string;

  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: Date, default: () => new Date() })
  processedAt: Date;
}

export type ProcessedEventDocument = HydratedDocument<ProcessedEvent>;
export const ProcessedEventSchema =
  SchemaFactory.createForClass(ProcessedEvent);

export const PROCESSED_EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

ProcessedEventSchema.index({ eventId: 1 }, { unique: true });
ProcessedEventSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: PROCESSED_EVENT_TTL_SECONDS },
);
