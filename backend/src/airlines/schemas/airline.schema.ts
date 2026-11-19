import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AirlineDocument = HydratedDocument<Airline>;

@Schema({ _id: false })
export class CancellationTier {
  @Prop({ required: true, min: 0 }) daysBefore: number;
  @Prop({ required: true, min: 0, max: 100 }) refundPercent: number;
}
const CancellationTierSchema = SchemaFactory.createForClass(CancellationTier);

@Schema({ _id: false })
export class BaggagePolicy {
  @Prop({ required: true, min: 0 }) freeBagsPerPassenger: number;
  @Prop({ required: true, min: 0 }) maxWeightKgPerBag: number;
  @Prop({ required: true, min: 0 }) extraBagPrice: number;
  @Prop({ required: true, min: 0 }) maxExtraBagsPerPassenger: number;
}
const BaggagePolicySchema = SchemaFactory.createForClass(BaggagePolicy);

@Schema({ _id: false })
export class FlightPolicies {
  @Prop({ required: true, enum: ['flight'], default: 'flight' }) kind: 'flight';
  @Prop({ type: [CancellationTierSchema], required: true })
  cancellationTiers: CancellationTier[];
  @Prop({ type: BaggagePolicySchema, required: true }) baggage: BaggagePolicy;
}
const FlightPoliciesSchema = SchemaFactory.createForClass(FlightPolicies);

@Schema({ timestamps: true })
export class Airline {
  @Prop({ required: true, trim: true, unique: true, uppercase: true })
  code: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, uppercase: true })
  countryCode: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ trim: true })
  logoUrl?: string;

  @Prop({ type: FlightPoliciesSchema })
  flightPolicies?: FlightPolicies;
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);
