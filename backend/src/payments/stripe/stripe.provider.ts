import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

/**
 * PAY-01: Stripe is used in TEST MODE ONLY. We refuse to boot with a live key
 * so real cards can never be charged by this project.
 */
export function assertTestModeKey(key: string | undefined): string {
  if (!key || !key.trim()) {
    throw new Error('STRIPE_SECRET_KEY is missing from backend/.env');
  }
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) {
    throw new Error(
      'STRIPE_SECRET_KEY is a LIVE key. This project only allows Stripe test mode (sk_test_...).',
    );
  }
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
    throw new Error(
      'STRIPE_SECRET_KEY must be a Stripe test key (sk_test_...)',
    );
  }
  return key;
}

export const stripeClientProvider: Provider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Stripe => {
    const key = assertTestModeKey(config.get<string>('STRIPE_SECRET_KEY'));
    return new Stripe(key, {
      maxNetworkRetries: 2,
      timeout: 15_000,
      appInfo: { name: 'travel-planning-platform' },
    });
  },
};
