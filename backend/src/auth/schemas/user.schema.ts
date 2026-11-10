import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ required: true, default: 'user' })
  role: string;

  @Prop({ required: true, default: false })
  acceptedTerms: boolean;

  @Prop({ required: true, default: false })
  acceptedPrivacyPolicy: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);