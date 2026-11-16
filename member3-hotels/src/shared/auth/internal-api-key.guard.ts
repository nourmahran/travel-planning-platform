import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { AuthUser } from './auth-user';
import { resolveUser } from './dev-auth';

interface GuardedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

function safeEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Guards endpoints that only the payment module (Member 4) or an administrator
 * may call, e.g. "confirm this reservation after Stripe verified the payment".
 *
 * The caller must send `x-internal-api-key: $INTERNAL_API_KEY` or already be an
 * authenticated administrator. If INTERNAL_API_KEY is not configured, only
 * administrators can call the endpoint.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const header = request.headers['x-internal-api-key'];
    const provided = Array.isArray(header) ? header[0] : header;
    const expected = process.env.INTERNAL_API_KEY;

    if (expected && provided && safeEqual(provided, expected)) {
      return true;
    }

    const user = resolveUser(request);
    if (user?.role === 'ADMIN') {
      request.user = user;
      return true;
    }

    throw new ForbiddenException(
      'This endpoint is reserved for the payment service. Send a valid x-internal-api-key header.',
    );
  }
}
