import { BadRequestException } from '@nestjs/common';

/**
 * PAY-04 — every flight/hotel price, payment and refund uses ONE platform
 * currency. It is configured with PLATFORM_CURRENCY (Stripe format: lowercase
 * ISO 4217, e.g. "usd"). Booking prices are never converted; the itinerary
 * currency conversion (ITN-18) is a separate, display-only feature.
 */
export const DEFAULT_PLATFORM_CURRENCY = 'usd';

/**
 * Currencies Stripe treats as zero-decimal. Our money helpers assume 2 decimal
 * places (amount * 100), so these are rejected as a platform currency.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

/** Minimal shape of ConfigService so this helper is easy to unit-test. */
export interface ConfigReader {
  get<T = string>(key: string): T | undefined;
}

export function normalizeCurrency(code: string): string {
  return code.trim().toLowerCase();
}

/** Reads PLATFORM_CURRENCY (default "usd") and validates it. */
export function getPlatformCurrency(config: ConfigReader): string {
  const raw = config.get<string>('PLATFORM_CURRENCY');
  const code = normalizeCurrency(
    raw && raw.trim() ? raw : DEFAULT_PLATFORM_CURRENCY,
  );
  if (!/^[a-z]{3}$/.test(code)) {
    throw new Error(
      `PLATFORM_CURRENCY must be a 3-letter ISO code, got "${code}"`,
    );
  }
  if (ZERO_DECIMAL_CURRENCIES.has(code)) {
    throw new Error(
      `PLATFORM_CURRENCY "${code}" is zero-decimal; only 2-decimal currencies are supported`,
    );
  }
  return code;
}

/** Throws 400 when `code` is not the platform currency (case-insensitive). */
export function assertPlatformCurrency(
  code: string,
  platformCurrency: string,
): void {
  if (
    !code ||
    normalizeCurrency(code) !== normalizeCurrency(platformCurrency)
  ) {
    throw new BadRequestException('Unsupported currency');
  }
}
