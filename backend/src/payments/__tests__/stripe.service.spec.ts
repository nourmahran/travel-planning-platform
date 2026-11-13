import { BadGatewayException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { assertTestModeKey } from '../stripe/stripe.provider';
import { StripeService } from '../stripe/stripe.service';

const config = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

function makeService(client: unknown) {
  return new StripeService(
    client as Stripe,
    config({ STRIPE_WEBHOOK_SECRET: 'whsec_test_dummy' }),
  );
}

describe('Stripe provider / service', () => {
  it('only accepts test-mode keys', () => {
    expect(() => assertTestModeKey(undefined)).toThrow(/missing/);
    expect(() => assertTestModeKey('sk_live_abc')).toThrow(/LIVE/);
    expect(() => assertTestModeKey('pk_test_abc')).toThrow();
    expect(assertTestModeKey('sk_test_abc')).toBe('sk_test_abc');
  });

  it('requires a webhook secret', () => {
    expect(() => new StripeService({} as Stripe, config({}))).toThrow(
      /STRIPE_WEBHOOK_SECRET/,
    );
  });

  it('creates PaymentIntents with an idempotency key and no redirects', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'pi_1' });
    const svc = makeService({ paymentIntents: { create } });
    await svc.createPaymentIntent({
      amountMinor: 1000,
      currency: 'usd',
      metadata: { bookingId: 'b1' },
      idempotencyKey: 'pi:flight:b1:1',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1000,
        currency: 'usd',
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      }),
      { idempotencyKey: 'pi:flight:b1:1' },
    );
  });

  it('returns null when cancelling a PaymentIntent in an unexpected state', async () => {
    const err = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      code: 'payment_intent_unexpected_state',
      message: 'already canceled',
    });
    const svc = makeService({
      paymentIntents: { cancel: jest.fn().mockRejectedValue(err) },
    });
    await expect(svc.cancelPaymentIntent('pi_1')).resolves.toBeNull();
  });

  it('wraps other Stripe errors as 502 Payment provider error', async () => {
    const err = new Stripe.errors.StripeAPIError({
      type: 'api_error',
      message: 'boom',
    });
    const svc = makeService({
      refunds: { create: jest.fn().mockRejectedValue(err) },
    });
    await expect(
      svc.createRefund({
        paymentIntentId: 'pi_1',
        amountMinor: 100,
        idempotencyKey: 'k',
        metadata: {},
      }),
    ).rejects.toThrow(BadGatewayException);
  });

  it('verifies webhook signatures with the real Stripe algorithm', () => {
    const real = new Stripe('sk_test_dummy');
    const svc = makeService(real);
    const payload = JSON.stringify({
      id: 'evt_1',
      type: 'ping',
      object: 'event',
    });
    const header = real.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_test_dummy',
    });
    expect(svc.constructWebhookEvent(Buffer.from(payload), header).id).toBe(
      'evt_1',
    );
    expect(() =>
      svc.constructWebhookEvent(Buffer.from(payload + ' '), header),
    ).toThrow();
  });
});
