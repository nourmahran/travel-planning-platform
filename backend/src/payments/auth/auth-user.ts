/**
 * The authenticated user as the payments module sees it.
 * TODO(part2): replace with the real user type from the auth module.
 */
export interface AuthUser {
  id: string;
  role: string;
}

export const ADMIN_ROLE = 'ADMIN';

export function isAdmin(user: AuthUser): boolean {
  return user.role === ADMIN_ROLE;
}
