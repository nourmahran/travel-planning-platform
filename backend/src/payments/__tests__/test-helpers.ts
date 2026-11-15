import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { BadGatewayException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type Stripe from 'stripe';
import { PaymentStatus } from '../schemas/payment.schema';
import type { StripeService } from '../stripe/stripe.service';
import { FakeModel } from './fake-model';

export const testConfig = (extra: Record<string, string> = {}) =>
  ({
    get: (k: string) => ({ PLATFORM_CURRENCY: 'usd', ...extra })[k],
  }) as unknown as ConfigService;

/** Fake models with the SAME unique indexes as the real schemas. */
export function makeModels() {
  const payments = new FakeModel([
    { fields: ['stripePaymentIntentId'] },
    {
      fields: ['bookingType', 'bookingId'],
      partial: { status: PaymentStatus.Succeeded },
    },
  ]);
  const refunds = new FakeModel([
    { fields: ['bookingType', 'bookingId'] },
    { fields: ['stripeRefundId'], sparse: true },
  ]);
  const events = new FakeModel([{ fields: ['eventId'] }]);
  return { payments, refunds, events };
}

export function asModel<T>(fake: FakeModel): Model<T> {
  return fake as unknown as Model<T>;
}

type FakePI = Pick<
  Stripe.PaymentIntent,
  'id' | 'status' | 'amount' | 'currency' | 'client_secret' | 'metadata'
> & { last_payment_error?: { message?: string } | null };

interface CreatePIParams {
  amountMinor: number;
  currency: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}
interface CreateRefundParams {
  paymentIntentId: string;
  amountMinor: number;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

/**
 * In-memory Stripe: PaymentIntents and Refunds, with idempotency keys
 * behaving like the real API (same key → same object).
 */
export class FakeStripe {
  pis = new Map<string, FakePI>();
  refunds: Array<{
    id: string;
    status: string;
    amount: number;
    payment_intent: string;
    metadata: Record<string, string>;
  }> = [];
  private byKey = new Map<string, string>();
  private n = 0;
  refundStatus = 'succeeded';
  failRefunds = false;
  createCalls = 0;

  createPaymentIntent: jest.Mock<
    Promise<Stripe.PaymentIntent>,
    [CreatePIParams]
  > = jest.fn(
    (p: {
      amountMinor: number;
      currency: string;
      metadata: Record<string, string>;
      idempotencyKey: string;
    }) => {
      this.createCalls++;
      const existing = this.byKey.get(p.idempotencyKey);
      if (existing)
        return Promise.resolve({
          ...this.pis.get(existing)!,
        } as Stripe.PaymentIntent);
      const id = `pi_${++this.n}`;
      const pi: FakePI = {
        id,
        status: 'requires_payment_method',
        amount: p.amountMinor,
        currency: p.currency,
        client_secret: `${id}_secret_test`,
        metadata: p.metadata,
      };
      this.pis.set(id, pi);
      this.byKey.set(p.idempotencyKey, id);
      return Promise.resolve({ ...pi } as Stripe.PaymentIntent);
    },
  );

  retrievePaymentIntent: jest.Mock<Promise<Stripe.PaymentIntent>, [string]> =
    jest.fn((id: string) => {
      const pi = this.pis.get(id);
      if (!pi)
        return Promise.reject(
          new BadGatewayException('Payment provider error'),
        );
      return Promise.resolve({ ...pi } as Stripe.PaymentIntent);
    });

  cancelPaymentIntent: jest.Mock<
    Promise<Stripe.PaymentIntent | null>,
    [string]
  > = jest.fn((id: string) => {
    const pi = this.pis.get(id);
    if (!pi || pi.status === 'succeeded' || pi.status === 'canceled') {
      return Promise.resolve(null);
    }
    pi.status = 'canceled';
    return Promise.resolve({ ...pi } as Stripe.PaymentIntent);
  });

  confirmTestPaymentIntent: jest.Mock<
    Promise<Stripe.PaymentIntent>,
    [string, string]
  > = jest.fn((id: string, pm: string) => {
    const pi = this.pis.get(id)!;
    pi.status = pm === 'pm_card_visa' ? 'succeeded' : 'requires_payment_method';
    return Promise.resolve({ ...pi } as Stripe.PaymentIntent);
  });

  createRefund: jest.Mock<Promise<Stripe.Refund>, [CreateRefundParams]> =
    jest.fn(
      (p: {
        paymentIntentId: string;
        amountMinor: number;
        idempotencyKey: string;
        metadata: Record<string, string>;
      }) => {
        if (this.failRefunds) {
          return Promise.reject(
            new BadGatewayException('Payment provider error'),
          );
        }
        const r = {
          id: `re_${++this.n}`,
          status: this.refundStatus,
          amount: p.amountMinor,
          payment_intent: p.paymentIntentId,
          metadata: p.metadata,
        };
        this.refunds.push(r);
        return Promise.resolve({ ...r } as unknown as Stripe.Refund);
      },
    );

  constructWebhookEvent: jest.Mock<Stripe.Event, [Buffer, string]> = jest.fn();

  /** Test helper: set a PaymentIntent's status directly. */
  setStatus(id: string, status: Stripe.PaymentIntent.Status) {
    this.pis.get(id)!.status = status;
  }

  asService(): StripeService {
    return this as unknown as StripeService;
  }
}

export const fakeEmitter = () => ({ emit: jest.fn() });
export const fakeNotifier = () => ({
  notify: jest.fn().mockResolvedValue(undefined),
});

/**
 * Test stand-in for the auth module's global JwtAuthGuard (ACC-04 / ACC-19):
 * honours @Public() and puts `{ id, role }` on req.user from the
 * `x-test-user-id` / `x-test-user-role` headers. Used only in tests, so the
 * payments wiring test doesn't need real JWT cookies or a user collection.
 */
@Injectable()
export class TestAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: { id: string; role: string };
    }>();
    const id = req.headers['x-test-user-id'];
    if (!id) throw new UnauthorizedException('Not logged in');
    req.user = { id, role: req.headers['x-test-user-role'] ?? 'user' };
    return true;
  }
}
