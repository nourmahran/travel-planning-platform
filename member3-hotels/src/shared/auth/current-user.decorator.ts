import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth-user';

/**
 * Injects the authenticated user (or one of its properties).
 *
 * `@CurrentUser() user: AuthUser` / `@CurrentUser('id') userId: string`
 *
 * The user is expected to be placed on the request by Member 1's session guard
 * (or, in the standalone sandbox only, by the development auth guard).
 */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) {
      return undefined;
    }
    return property ? user[property] : user;
  },
);
