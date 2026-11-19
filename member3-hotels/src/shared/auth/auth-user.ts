import type { UserRole } from '../constants';

/**
 * Shape of the authenticated principal attached to the request by Member 1's
 * authentication layer.
 *
 * INTEGRATION: Member 1 owns accounts and sessions. Their guard must populate
 * `req.user` with at least `id` and `role`. `role` values are mapped in
 * INTEGRATION.md (e.g. their `hotel_moderator` role becomes `HOTEL_MODERATOR`).
 */
export interface AuthUser {
  id: string;
  role: UserRole;
  email?: string;
}

export function isUserRole(value: unknown): value is UserRole {
  return value === 'USER' || value === 'HOTEL_MODERATOR' || value === 'ADMIN';
}
