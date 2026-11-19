import { UserRole } from '../../auth/constants/roles';

/**
 * The part of the logged-in user that payments needs.
 * Set on the request by the global JwtAuthGuard (auth module, ACC-04 / ACC-19);
 * controllers read it with the auth module's @CurrentUser().
 */
export interface AuthUser {
  id: string;
  role: string;
}

export const ADMIN_ROLE: string = UserRole.ADMIN;

/** ACC-11 / ACC-17: admins may read any payment or refund. */
export function isAdmin(user: AuthUser): boolean {
  return user.role === ADMIN_ROLE;
}
