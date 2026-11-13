import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isValidObjectId } from 'mongoose';
import { isDevPaymentsEnabled } from '../payments.config';
import { ADMIN_ROLE } from './auth-user';
import { toAuthUser } from './current-user.decorator';

export const DEV_USER_HEADER = 'x-dev-user-id';
export const DEV_ROLE_HEADER = 'x-dev-user-role';

interface GuardRequest {
  user?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Placeholder authentication guard for the payments module (Part 1).
 *
 * 1. If the real JWT guard already put a user on the request → allow.
 * 2. DEV ONLY (ENABLE_DEV_PAYMENT_ENDPOINTS=true and NODE_ENV != production):
 *    accept `x-dev-user-id: <ObjectId>` (and optional `x-dev-user-role: ADMIN`)
 *    so the routes can be exercised in Swagger before auth is merged.
 * 3. Otherwise → 401.
 *
 * TODO(part2): use real auth guard (global JwtAuthGuard reading the httpOnly
 * cookie) and delete this file together with the dev header fallback.
 */
@Injectable()
export class PaymentsAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<GuardRequest>();
    if (toAuthUser(req.user)) return true;

    if (isDevPaymentsEnabled(this.config)) {
      const id = header(req, DEV_USER_HEADER);
      if (id && isValidObjectId(id)) {
        const role =
          header(req, DEV_ROLE_HEADER) === ADMIN_ROLE ? ADMIN_ROLE : 'USER';
        req.user = { id, role };
        return true;
      }
    }
    throw new UnauthorizedException('Not logged in');
  }
}

function header(req: GuardRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
