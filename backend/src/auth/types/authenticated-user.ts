import { UserRole } from '../constants/roles';

/**
 * Safe authenticated identity attached to the request by JwtAuthGuard.
 * Compatible with payments' expected { id, role } shape.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  mustChangePassword: boolean;
  providerType: 'airline' | 'hotel' | null;
  providerId: string | null;
  sessionId: string;
}
