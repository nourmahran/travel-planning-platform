import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** One cached rate table per UTC day, base USD (ITN-18). */
@Schema({ collection: 'exchange_rates' })
export class ExchangeRate {
  @Prop({ required: true, unique: true })
  date: string;

  @Prop({ required: true, default: 'USD', uppercase: true })
  base: string;

  @Prop({ type: Object, required: true })
  rates: Record<string, number>;

  @Prop({ required: true })
  fetchedAt: Date;

  @Prop({ required: true, default: 'fxratesapi' })
  source: string;
}

export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;
