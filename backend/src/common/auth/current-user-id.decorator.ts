import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user';

interface RequestWithUser {
  user?: AuthenticatedUser;
}

/**
 * The authenticated user's id, as attached by Member 1's JwtAuthGuard.
 *
 * The itineraries module only needs the id for ownership; the full identity is
 * available through `@CurrentUser()` in src/auth/decorators. Reaching this
 * decorator without a guard means the route was never authenticated, so it
 * answers 401 rather than handing the service an undefined owner.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const userId = request.user?.id;

    if (!userId) {
      throw new UnauthorizedException('Not logged in');
    }

    return userId;
  },
);
