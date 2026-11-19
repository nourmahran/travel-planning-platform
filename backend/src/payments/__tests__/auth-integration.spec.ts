import { Reflector } from '@nestjs/core';
import { UserRole } from '../../auth/constants/roles';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { ADMIN_ROLE, isAdmin } from '../auth/auth-user';
import { WebhookController } from '../webhook.controller';

describe('payments ↔ auth module (ACC-04 / ACC-19)', () => {
  it('uses the auth module admin role name', () => {
    expect(ADMIN_ROLE).toBe(UserRole.ADMIN);
    expect(isAdmin({ id: 'a', role: UserRole.ADMIN })).toBe(true);
  });

  it.each([
    UserRole.USER,
    UserRole.AIRLINE_MODERATOR,
    UserRole.HOTEL_MODERATOR,
  ])('%s is not treated as admin', (role) => {
    expect(isAdmin({ id: 'a', role })).toBe(false);
  });

  it('keeps the Stripe webhook public for the global JwtAuthGuard', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      WebhookController.prototype,
      'handle',
    )?.value as () => unknown;
    expect(handler).toBeDefined();
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBe(true);
  });
});
