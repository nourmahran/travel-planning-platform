import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

import { DevUserGuard } from './dev-user.guard';

type FakeRequest = {
  headers: Record<string, string | undefined>;
  user?: { id: string; role: string };
};

const makeContext = (headers: Record<string, string | undefined>) => {
  const request: FakeRequest = { headers };

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
};

describe('DevUserGuard', () => {
  const guard = new DevUserGuard();
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDevAuth = process.env.ENABLE_DEV_AUTH;

  const useEnv = (nodeEnv: string | undefined, devAuth: string | undefined) => {
    process.env.NODE_ENV = nodeEnv;
    process.env.ENABLE_DEV_AUTH = devAuth;
  };

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.ENABLE_DEV_AUTH = previousDevAuth;
  });

  it('accepts a valid user id header when dev auth is enabled', () => {
    useEnv('development', 'true');
    const { context, request } = makeContext({
      'x-dev-user-id': 'a'.repeat(24),
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual({ id: 'a'.repeat(24), role: 'user' });
  });

  it('refuses when dev auth is not enabled', () => {
    useEnv('development', undefined);
    const { context } = makeContext({ 'x-dev-user-id': 'a'.repeat(24) });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('refuses in production even when dev auth is enabled', () => {
    useEnv('production', 'true');
    const { context } = makeContext({ 'x-dev-user-id': 'a'.repeat(24) });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('refuses a malformed user id', () => {
    useEnv('development', 'true');
    const { context } = makeContext({ 'x-dev-user-id': 'not-an-object-id' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('refuses a missing user id', () => {
    useEnv('development', 'true');
    const { context } = makeContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
