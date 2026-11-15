import { percentOf } from '../common/booking';
import type { CancellationTier } from './gateway/booking-gateway.interface';
import { RefundReason } from './schemas/refund.schema';

const MS_PER_DAY = 86_400_000;

export type BookingKind = 'flight' | 'hotel';
export type RefundReasonValue = `${RefundReason}`;

/**
 * How many whole days are left before the booking starts.
 *
 * - **flight** — `startsAt` is the outbound departure instant (UTC). We count
 *   FULL 24-hour periods: `floor((departure - now) / 24h)`. Example: departure
 *   in 6 days 23 hours → 6 days. This never rounds up, so a user can never get
 *   a better tier than they are entitled to just because of the time of day.
 *   For a round trip (FLT-12a) the caller passes the OUTBOUND departure.
 *
 * - **hotel** — a stay is date-based (no time of day), so we count CALENDAR
 *   days between today's UTC date and the check-in UTC date. Example: now is
 *   2026-11-08 23:59Z, check-in 2026-11-10 → 2 days, and one minute later
 *   (2026-11-09 00:00Z) → 1 day.
 *
 * The result can be negative when the start is already in the past.
 */
export function daysRemaining(
  startsAt: Date,
  now: Date,
  kind: BookingKind,
): number {
  if (kind === 'flight') {
    return Math.floor((startsAt.getTime() - now.getTime()) / MS_PER_DAY);
  }
  const startDay = Date.UTC(
    startsAt.getUTCFullYear(),
    startsAt.getUTCMonth(),
    startsAt.getUTCDate(),
  );
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.round((startDay - today) / MS_PER_DAY);
}

/**
 * FLT-09 / HTL-10: each tier has a unique `daysBefore` (integer >= 0) and a
 * `refundPercent` (0–100). Throws on invalid tiers.
 */
export function validateTiers(tiers: CancellationTier[]): void {
  const seen = new Set<number>();
  for (const t of tiers) {
    if (!Number.isInteger(t.daysBefore) || t.daysBefore < 0) {
      throw new RangeError('Tier daysBefore must be an integer >= 0');
    }
    if (
      typeof t.refundPercent !== 'number' ||
      !Number.isFinite(t.refundPercent) ||
      t.refundPercent < 0 ||
      t.refundPercent > 100
    ) {
      throw new RangeError('Tier refundPercent must be between 0 and 100');
    }
    if (seen.has(t.daysBefore)) {
      throw new RangeError(`Duplicate tier threshold: ${t.daysBefore} days`);
    }
    seen.add(t.daysBefore);
  }
}

/**
 * Tier rule: use the tier with the HIGHEST `daysBefore` that does not exceed
 * the days remaining. If no tier applies, the refund is 0%.
 *
 * Example tiers [{30,100},{7,50},{0,0}]: 40 days → 100%, 29 → 50%, 6 → 0%.
 */
export function selectRefundPercent(
  tiers: CancellationTier[],
  days: number,
): number {
  validateTiers(tiers);
  let best: CancellationTier | null = null;
  for (const t of tiers) {
    if (t.daysBefore <= days && (!best || t.daysBefore > best.daysBefore)) {
      best = t;
    }
  }
  return best ? best.refundPercent : 0;
}

export interface RefundCalculation {
  percent: number;
  amountMinor: number;
  daysRemaining: number;
}

/**
 * PAY-03 refund amount.
 * - ProviderCancellation (FLT-06) and LatePayment → always 100%.
 * - UserCancellation → tier rule on the policy snapshot the user accepted.
 * The amount is computed on the FULL total in integer minor units (HTL-21).
 */
export function calculateRefund(input: {
  totalAmountMinor: number;
  tiers: CancellationTier[];
  startsAt: Date;
  now: Date;
  kind: BookingKind;
  reason: RefundReasonValue;
}): RefundCalculation {
  const days = daysRemaining(input.startsAt, input.now, input.kind);
  const percent =
    input.reason === RefundReason.UserCancellation
      ? selectRefundPercent(input.tiers, days)
      : 100;
  return {
    percent,
    amountMinor: percentOf(input.totalAmountMinor, percent),
    daysRemaining: days,
  };
}
