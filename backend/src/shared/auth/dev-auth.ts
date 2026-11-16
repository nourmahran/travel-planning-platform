import { isUserRole, type AuthUser } from './auth-user';

const OBJECT_ID = /^[a-f0-9]{24}$/i;

interface HeaderCarrier {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function isObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

/**
 * STANDALONE SANDBOX ONLY.
 *
 * Until Member 1's cookie-session guard is merged, the sandbox can be driven
 * with:
 *   x-user-id: <24 hex ObjectId>
 *   x-user-role: USER | HOTEL_MODERATOR | ADMIN
 *
 * This never runs when AUTH_DEV_MODE is not exactly "true".
 */
export function readDevUser(request: HeaderCarrier): AuthUser | undefined {
  if (process.env.AUTH_DEV_MODE !== 'true') {
    return undefined;
  }

  const id = headerValue(request.headers['x-user-id']);
  const role = headerValue(request.headers['x-user-role']) ?? 'USER';
  const email = headerValue(request.headers['x-user-email']);

  if (!isObjectIdString(id) || !isUserRole(role)) {
    return undefined;
  }

  return { id, role, ...(email ? { email } : {}) };
}

/** Resolves the principal, accepting one already set by Member 1's guard. */
export function resolveUser(request: HeaderCarrier): AuthUser | undefined {
  const user = request.user as
    (AuthUser & { role: string; providerId?: string | null }) | undefined;
  if (!user) return undefined;
  const roles: Record<string, AuthUser['role']> = {
    user: 'USER',
    hotel_moderator: 'HOTEL_MODERATOR',
    admin: 'ADMIN',
  };
  const role = roles[user.role] ?? user.role;
  if (!isUserRole(role)) return undefined;
  return { id: user.id, role, email: user.email, providerId: user.providerId };
}
