import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AccountStatus } from '../constants/account-status';
import { UserRole } from '../constants/roles';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(UserRole),
    default: UserRole.USER,
  })
  role: UserRole;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(AccountStatus),
    default: AccountStatus.ACTIVE,
  })
  status: AccountStatus;

  @Prop({ required: true, default: false })
  acceptedTerms: boolean;

  @Prop({ required: true, default: false })
  acceptedPrivacyPolicy: boolean;

  @Prop({ type: String, trim: true, default: null, required: false })
  phone: string | null;

  @Prop({ trim: true, uppercase: true, default: 'USD' })
  preferredCurrency: string;

  /** ACC-05 */
  @Prop({ required: true, default: 0, min: 0 })
  failedLoginAttempts: number;

  /** ACC-05 — when set and in the future, login is blocked. */
  @Prop({ type: Date, default: null })
  lockUntil: Date | null;

  /** ACC-07a / ACC-13 — temporary password must be changed. */
  @Prop({ required: true, default: false })
  mustChangePassword: boolean;

  /** ACC-13 — moderator belongs to exactly one provider. */
  @Prop({
    type: String,
    enum: ['airline', 'hotel'],
    default: null,
    required: false,
  })
  providerType: 'airline' | 'hotel' | null;

  @Prop({ type: Types.ObjectId, default: null })
  providerId: Types.ObjectId | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
