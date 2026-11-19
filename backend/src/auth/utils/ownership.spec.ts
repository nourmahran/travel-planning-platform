import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../constants/roles';
import { AuthenticatedUser } from '../types/authenticated-user';
import { assertCanAccessOwnedResource } from './ownership';

function makeUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    role: UserRole.USER,
    mustChangePassword: false,
    providerType: null,
    providerId: null,
    sessionId: 'session-1',
    ...overrides,
  };
}

describe('assertCanAccessOwnedResource', () => {
  it('allows admins to access any resource', () => {
    expect(() =>
      assertCanAccessOwnedResource(makeUser({ role: UserRole.ADMIN }), {
        ownerUserId: 'someone-else',
      }),
    ).not.toThrow();
  });

  it('allows the owner to access their own resource', () => {
    expect(() =>
      assertCanAccessOwnedResource(makeUser(), { ownerUserId: 'user-1' }),
    ).not.toThrow();
  });

  it('allows a moderator for their assigned provider', () => {
    expect(() =>
      assertCanAccessOwnedResource(
        makeUser({
          role: UserRole.AIRLINE_MODERATOR,
          providerType: 'airline',
          providerId: 'airline-1',
        }),
        { providerType: 'airline', providerId: 'airline-1' },
      ),
    ).not.toThrow();
  });

  it('rejects access to another user resource', () => {
    expect(() =>
      assertCanAccessOwnedResource(makeUser(), {
        ownerUserId: 'other-user',
      }),
    ).toThrow(ForbiddenException);
  });
});
