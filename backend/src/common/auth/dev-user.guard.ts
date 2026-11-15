
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

export const DEV_USER_HEADER = 'x-dev-user-id';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export type AuthenticatedUser = {
  id: string;
  role: string;
};

export type RequestWithUser = Request & {
  user?: AuthenticatedUser;
};

/**
 * Temporary authentication for the itineraries module.
 *
 * TODO: delete once Member 1's cookie-based guard exists. It only runs when
 * NODE_ENV is not production and ENABLE_DEV_AUTH is 'true', and it trusts the
 * x-dev-user-id header, so two ObjectIds are enough to demonstrate ownership.
 */
@Injectable()
export class DevUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!this.isEnabled()) {
      throw new UnauthorizedException('Authentication is required');
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers[DEV_USER_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    const userId = typeof value === 'string' ? value.trim() : '';

    if (!OBJECT_ID_PATTERN.test(userId)) {
      throw new UnauthorizedException(
        `Missing or malformed ${DEV_USER_HEADER} header`,
      );
    }

    request.user = { id: userId, role: 'user' };

    return true;
  }

  private isEnabled(): boolean {
    return (
      process.env.NODE_ENV !== 'production' &&
      process.env.ENABLE_DEV_AUTH === 'true'
    );
  }
}
