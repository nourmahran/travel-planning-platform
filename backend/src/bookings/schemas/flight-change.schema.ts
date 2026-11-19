import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type FlightChangeDocument = HydratedDocument<FlightChange>;

@Schema({ collection: 'flight_changes', timestamps: true })
export class FlightChange {
  @Prop({ type: SchemaTypes.ObjectId, required: true }) bookingId: Types.ObjectId;
  @Prop({ type: SchemaTypes.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ type: String, enum: ['outbound', 'return'], required: true }) leg: 'outbound' | 'return';
  @Prop({ type: SchemaTypes.ObjectId, required: true }) oldFlightId: Types.ObjectId;
  @Prop({ type: SchemaTypes.ObjectId, required: true }) newFlightId: Types.ObjectId;
  @Prop({ type: String, required: true }) cabinClass: string;
  @Prop({ type: Number, required: true }) oldLegAmount: number;
  @Prop({ type: Number, required: true }) newLegAmount: number;
  @Prop({ type: Number, required: true }) amountDue: number;
  @Prop({ type: Number, required: true }) refundAmount: number;
  @Prop({ type: Number, required: true }) seatsRequired: number;
  @Prop({ type: Number, required: true }) oldSeats: number;
  @Prop({ type: Date, required: true }) holdExpiresAt: Date;
  @Prop({ type: String, enum: ['PendingPayment', 'Confirmed', 'Expired'], required: true }) status: string;
  @Prop({ type: [SchemaTypes.Mixed], default: [] }) newPassengers: Array<Record<string, unknown>>;
  @Prop({ type: Boolean, default: false }) refundDispatchPending: boolean;
  @Prop({ type: Date }) confirmedAt?: Date;
  @Prop({ type: Date }) expiredAt?: Date;
}

export const FlightChangeSchema = SchemaFactory.createForClass(FlightChange);
FlightChangeSchema.index({ bookingId: 1 }, {
  unique: true,
  partialFilterExpression: { status: 'PendingPayment' },
});
FlightChangeSchema.index({ status: 1, holdExpiresAt: 1 });
