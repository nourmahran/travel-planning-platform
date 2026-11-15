import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../types/authenticated-user';

interface RequestWithUser {
  user?: AuthenticatedUser;
}

/**
 * Injects the authenticated user attached by JwtAuthGuard.
 * Throws 401 when no user is present.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new UnauthorizedException('Not logged in');
    }
    return request.user;
  },
);
