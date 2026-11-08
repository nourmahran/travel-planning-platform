import type { ConfigReader } from './platform-currency';

/** FLT-22 / HTL-18 — a booking is held as PendingPayment for 10 minutes. */
export const DEFAULT_BOOKING_HOLD_MINUTES = 10;

/** Reads BOOKING_HOLD_MINUTES (default 10, from FLT-22 / HTL-18). */
export function getBookingHoldMinutes(config: ConfigReader): number {
  const raw = config.get<string>('BOOKING_HOLD_MINUTES');
  if (raw === undefined || raw === '') return DEFAULT_BOOKING_HOLD_MINUTES;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error('BOOKING_HOLD_MINUTES must be a positive integer');
  }
  return minutes;
}
