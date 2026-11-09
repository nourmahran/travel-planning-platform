
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FlightDocument = HydratedDocument<Flight>;

export enum FlightStatus {
  SCHEDULED = 'Scheduled',
  CANCELLED = 'Cancelled',
  DEPARTED = 'Departed',
}

export enum CabinClass {
  ECONOMY = 'Economy',
  PREMIUM_ECONOMY = 'Premium Economy',
  BUSINESS = 'Business',
  FIRST = 'First',
}

@Schema({ _id: false })
export class CabinDetails {
  @Prop({
    required: true,
    enum: Object.values(CabinClass),
  })
  cabinClass: CabinClass;

  @Prop({ required: true, min: 0 })
  price: number;

  @Prop({ required: true, min: 0 })
  totalSeats: number;

  @Prop({ required: true, min: 0 })
  availableSeats: number;

  @Prop({ required: true, min: 0 })
  baggageAllowanceKg: number;

  @Prop({ default: 0, min: 0 })
  extraBaggagePricePerKg: number;
}

export const CabinDetailsSchema =
  SchemaFactory.createForClass(CabinDetails);

@Schema({ timestamps: true })
export class Flight {
  @Prop({
    type: Types.ObjectId,
    ref: 'Airline',
    required: true,
  })
  airlineId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  flightNumber: string;

  @Prop({ required: true, uppercase: true })
  departureAirport: string;

  @Prop({ required: true, uppercase: true })
  arrivalAirport: string;

  @Prop({ required: true })
  departureTimeUtc: Date;

  @Prop({ required: true })
  arrivalTimeUtc: Date;

  @Prop({ required: true })
  departureTimeZone: string;

  @Prop({ required: true })
  arrivalTimeZone: string;

  @Prop({
    type: [CabinDetailsSchema],
    default: [],
  })
  cabins: CabinDetails[];

  @Prop({
    enum: Object.values(FlightStatus),
    default: FlightStatus.SCHEDULED,
  })
  status: FlightStatus;
}

export const FlightSchema = SchemaFactory.createForClass(Flight);

FlightSchema.index({
  departureAirport: 1,
  arrivalAirport: 1,
  departureTimeUtc: 1,
});
