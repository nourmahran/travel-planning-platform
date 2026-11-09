
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AirlineDocument = HydratedDocument<Airline>;

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
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);
