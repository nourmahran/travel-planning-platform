import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from './auth-user';
import { resolveUser } from './dev-auth';

/**
 * Requires an authenticated user.
 *
 * INTEGRATION: replace with Member 1's session/roles guard. The module only
 * relies on the contract "req.user: { id, role }". In the standalone sandbox
 * the principal can come from the AUTH_DEV_MODE headers.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; user?: AuthUser }>();
    const user = resolveUser(request);
    if (!user) {
      throw new UnauthorizedException(
        process.env.AUTH_DEV_MODE === 'true'
          ? 'Authentication required. In sandbox mode send x-user-id (24 hex) and x-user-role headers.'
          : 'Authentication required.',
      );
    }
    request.user = user;
    return true;
  }
}

/**
 * Attaches the principal when present but never rejects the request.
 * Used by public endpoints that show extra data to the owning moderator/admin
 * or personalise the response for the signed-in user.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; user?: AuthUser }>();
    const user = resolveUser(request);
    if (user) {
      request.user = user;
    }
    return true;
  }
}
