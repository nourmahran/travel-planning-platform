import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from './stripe.provider';

/** Test payment methods the dev endpoint may use (Stripe test tokens, not card data). */
export const ALLOWED_TEST_PAYMENT_METHODS = [
  'pm_card_visa',
  'pm_card_chargeDeclined',
  'pm_card_visa_chargeDeclinedInsufficientFunds',
] as const;
export type TestPaymentMethod = (typeof ALLOWED_TEST_PAYMENT_METHODS)[number];

/**
 * Thin wrapper around the Stripe SDK so the rest of the module never talks to
 * Stripe directly and tests can replace it with a plain mock object.
 *
 * Security notes:
 *  - Card details never reach this backend. The browser sends them straight to
 *    Stripe (Stripe Elements); we only create PaymentIntents and read status.
 *  - We log Stripe error *codes* only, never the full error object, the
 *    client secret, or the webhook secret.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly webhookSecret: string;

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    config: ConfigService,
  ) {
    const secret = config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret || !secret.trim()) {
      throw new Error('STRIPE_WEBHOOK_SECRET is missing from backend/.env');
    }
    this.webhookSecret = secret;
  }

  async createPaymentIntent(params: {
    amountMinor: number;
    currency: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.create(
        {
          amount: params.amountMinor,
          currency: params.currency,
          metadata: params.metadata,
          // Card-only flow without redirects: works with Stripe Elements and
          // with the test payment-method tokens used by the dev endpoint.
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
        },
        { idempotencyKey: params.idempotencyKey },
      );
    } catch (err) {
      throw this.wrap('createPaymentIntent', err);
    }
  }

  async retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.retrieve(id);
    } catch (err) {
      throw this.wrap('retrievePaymentIntent', err);
    }
  }

  /**
   * Cancels a PaymentIntent. Returns null (instead of throwing) when Stripe
   * says it can no longer be cancelled — already canceled or succeeded — so
   * callers like the hold-expiry job can call this safely many times.
   */
  async cancelPaymentIntent(id: string): Promise<Stripe.PaymentIntent | null> {
    try {
      return await this.stripe.paymentIntents.cancel(id);
    } catch (err) {
      if (stripeErrorCode(err) === 'payment_intent_unexpected_state') {
        return null;
      }
      throw this.wrap('cancelPaymentIntent', err);
    }
  }

  /** DEV ONLY: confirms a PaymentIntent with a Stripe test token (e.g. pm_card_visa). */
  async confirmTestPaymentIntent(
    id: string,
    testPaymentMethod: TestPaymentMethod,
  ): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.confirm(id, {
        payment_method: testPaymentMethod,
      });
    } catch (err) {
      // A declined test card is an expected outcome, not a provider failure:
      // Stripe also sends payment_intent.payment_failed, which updates our record.
      if (err instanceof Stripe.errors.StripeCardError) {
        return this.retrievePaymentIntent(id);
      }
      throw this.wrap('confirmTestPaymentIntent', err);
    }
  }

  async createRefund(params: {
    paymentIntentId: string;
    amountMinor: number;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<Stripe.Refund> {
    try {
      return await this.stripe.refunds.create(
        {
          payment_intent: params.paymentIntentId,
          amount: params.amountMinor,
          metadata: params.metadata,
        },
        { idempotencyKey: params.idempotencyKey },
      );
    } catch (err) {
      throw this.wrap('createRefund', err);
    }
  }

  /**
   * Verifies the `stripe-signature` header (HMAC-SHA256 of the RAW body with
   * STRIPE_WEBHOOK_SECRET, plus a timestamp tolerance against replays) and
   * returns the parsed event. Throws if the signature is invalid.
   */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }

  private wrap(operation: string, err: unknown): BadGatewayException {
    this.logger.error(
      `Stripe ${operation} failed: code=${stripeErrorCode(err) ?? 'unknown'} type=${stripeErrorType(err) ?? 'unknown'}`,
    );
    return new BadGatewayException('Payment provider error');
  }
}

export function stripeErrorCode(err: unknown): string | undefined {
  return err instanceof Stripe.errors.StripeError ? err.code : undefined;
}

function stripeErrorType(err: unknown): string | undefined {
  return err instanceof Stripe.errors.StripeError ? err.type : undefined;
}
