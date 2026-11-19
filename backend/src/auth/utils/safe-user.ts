import { UserDocument } from '../schemas/user.schema';
import { UserRole } from '../constants/roles';
import { AccountStatus } from '../constants/account-status';

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  phone: string | null;
  preferredCurrency: string;
  mustChangePassword: boolean;
  providerType: 'airline' | 'hotel' | null;
  providerId: string | null;
  emailVerified: boolean;
  emailNotifications: boolean;
}

export function toSafeUser(user: UserDocument): SafeUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    phone: user.phone ?? null,
    preferredCurrency: user.preferredCurrency ?? 'USD',
    mustChangePassword: user.mustChangePassword,
    providerType: user.providerType ?? null,
    providerId: user.providerId ? user.providerId.toString() : null,
    emailVerified: user.emailVerified !== false,
    emailNotifications: user.emailNotifications !== false,
  };
}
