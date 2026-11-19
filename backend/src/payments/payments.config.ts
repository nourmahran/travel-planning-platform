import type { ConfigReader } from '../common/booking';

/**
 * Dev-only helper (the dev confirm endpoint) is enabled
 * only when ENABLE_DEV_PAYMENT_ENDPOINTS=true AND NODE_ENV is not production.
 */
export function isDevPaymentsEnabled(config: ConfigReader): boolean {
  return (
    config.get<string>('ENABLE_DEV_PAYMENT_ENDPOINTS') === 'true' &&
    config.get<string>('NODE_ENV') !== 'production'
  );
}

/** Refuse to boot if someone turns the dev endpoints on in production. */
export function assertDevFlagSafe(config: ConfigReader): void {
  if (
    config.get<string>('NODE_ENV') === 'production' &&
    config.get<string>('ENABLE_DEV_PAYMENT_ENDPOINTS') === 'true'
  ) {
    throw new Error(
      'ENABLE_DEV_PAYMENT_ENDPOINTS must be false when NODE_ENV=production',
    );
  }
}
