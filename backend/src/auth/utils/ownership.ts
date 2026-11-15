import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../types/authenticated-user';
import { UserRole } from '../constants/roles';

/**
 * ACC-11 — ownership helper used by booking/itinerary modules.
 * Admins may access everything. Moderators may access their provider.
 * Users may access only their own resources.
 */
export function assertCanAccessOwnedResource(
  user: AuthenticatedUser,
  options: {
    ownerUserId?: string | null;
    providerType?: 'airline' | 'hotel' | null;
    providerId?: string | null;
  },
): void {
  if (user.role === UserRole.ADMIN) {
    return;
  }

  if (
    (user.role === UserRole.AIRLINE_MODERATOR ||
      user.role === UserRole.HOTEL_MODERATOR) &&
    user.providerType &&
    user.providerId &&
    options.providerType === user.providerType &&
    options.providerId === user.providerId
  ) {
    return;
  }

  if (options.ownerUserId && options.ownerUserId === user.id) {
    return;
  }

  throw new ForbiddenException(
    'You do not have permission to access this resource',
  );
}
