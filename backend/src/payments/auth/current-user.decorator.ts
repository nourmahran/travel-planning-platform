import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from './auth-user';

interface RequestWithUser {
  user?: { id?: unknown; _id?: unknown; sub?: unknown; role?: unknown };
}

/**
 * Placeholder @CurrentUser() for the payments module.
 * Reads `req.user` (set by the JWT guard) and normalises it to { id, role }.
 * TODO(part2): use real auth guard / decorator from the auth module.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = toAuthUser(req.user);
    if (!user) throw new UnauthorizedException('Not logged in');
    return user;
  },
);

export function toAuthUser(raw: RequestWithUser['user']): AuthUser | null {
  if (!raw) return null;
  const id = raw.id ?? raw._id ?? raw.sub;
  if (id === undefined || id === null) return null;
  return {
    id: String(id as string),
    role: typeof raw.role === 'string' ? raw.role : 'USER',
  };
}
