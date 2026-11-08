import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { PaymentsAuthGuard } from '../auth/payments-auth.guard';
import { assertDevFlagSafe, isDevPaymentsEnabled } from '../payments.config';

const config = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

function ctx(req: { user?: unknown; headers: Record<string, string> }) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('PaymentsAuthGuard (placeholder until auth is merged)', () => {
  const userId = new Types.ObjectId().toString();
  const devOn = config({ ENABLE_DEV_PAYMENT_ENDPOINTS: 'true' });

  it('allows a request that already has a user from the JWT guard', () => {
    const guard = new PaymentsAuthGuard(config({}));
    expect(guard.canActivate(ctx({ user: { id: userId }, headers: {} }))).toBe(
      true,
    );
  });

  it('rejects anonymous requests with 401', () => {
    const guard = new PaymentsAuthGuard(devOn);
    expect(() => guard.canActivate(ctx({ headers: {} }))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts the dev header only when dev endpoints are enabled', () => {
    const req = { headers: { 'x-dev-user-id': userId } } as {
      user?: unknown;
      headers: Record<string, string>;
    };
    expect(new PaymentsAuthGuard(devOn).canActivate(ctx(req))).toBe(true);
    expect(req.user).toEqual({ id: userId, role: 'USER' });

    const off = new PaymentsAuthGuard(config({}));
    expect(() =>
      off.canActivate(ctx({ headers: { 'x-dev-user-id': userId } })),
    ).toThrow(UnauthorizedException);
  });

  it('never accepts the dev header in production', () => {
    const prod = config({
      ENABLE_DEV_PAYMENT_ENDPOINTS: 'true',
      NODE_ENV: 'production',
    });
    expect(isDevPaymentsEnabled(prod)).toBe(false);
    expect(() => assertDevFlagSafe(prod)).toThrow();
    expect(() =>
      new PaymentsAuthGuard(prod).canActivate(
        ctx({ headers: { 'x-dev-user-id': userId } }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a malformed dev user id', () => {
    expect(() =>
      new PaymentsAuthGuard(devOn).canActivate(
        ctx({ headers: { 'x-dev-user-id': 'not-an-id' } }),
      ),
    ).toThrow(UnauthorizedException);
  });
});
