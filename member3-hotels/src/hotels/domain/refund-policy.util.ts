import { BadRequestException } from '@nestjs/common';

export interface CancellationTierLike {
  minDaysBeforeCheckIn: number;
  refundPercent: number;
  description?: string;
}

export interface RefundCalculation {
  percent: number;
  amountCents: number;
  tier: CancellationTierLike | null;
}

/**
 * HTL-10: hotel cancellation tiers.
 *
 * A tier applies when the cancellation happens at least
 * `minDaysBeforeCheckIn` days before check-in; the tier with the largest
 * threshold that still matches wins. A 0-day tier is mandatory so that every
 * cancellation resolves to a defined refund.
 */
export function normalizeCancellationTiers(tiers: CancellationTierLike[]): CancellationTierLike[] {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new BadRequestException('cancellationTiers must contain at least one tier.');
  }

  const thresholds = new Set<number>();
  for (const tier of tiers) {
    if (!Number.isInteger(tier.minDaysBeforeCheckIn) || tier.minDaysBeforeCheckIn < 0 || tier.minDaysBeforeCheckIn > 365) {
      throw new BadRequestException('Each cancellation tier needs minDaysBeforeCheckIn between 0 and 365.');
    }
    if (!Number.isInteger(tier.refundPercent) || tier.refundPercent < 0 || tier.refundPercent > 100) {
      throw new BadRequestException('Each cancellation tier needs refundPercent between 0 and 100.');
    }
    if (thresholds.has(tier.minDaysBeforeCheckIn)) {
      throw new BadRequestException('Cancellation tiers cannot repeat the same minDaysBeforeCheckIn value.');
    }
    thresholds.add(tier.minDaysBeforeCheckIn);
  }

  if (!thresholds.has(0)) {
    throw new BadRequestException('Cancellation tiers must include a 0-day tier so late cancellations have a defined refund.');
  }

  return [...tiers]
    .map((tier) => ({
      minDaysBeforeCheckIn: tier.minDaysBeforeCheckIn,
      refundPercent: tier.refundPercent,
      ...(tier.description ? { description: tier.description } : {}),
    }))
    .sort((a, b) => b.minDaysBeforeCheckIn - a.minDaysBeforeCheckIn);
}

export function selectCancellationTier(
  tiers: CancellationTierLike[],
  daysBeforeCheckIn: number,
): CancellationTierLike | null {
  const ordered = [...tiers].sort((a, b) => b.minDaysBeforeCheckIn - a.minDaysBeforeCheckIn);
  return ordered.find((tier) => daysBeforeCheckIn >= tier.minDaysBeforeCheckIn) ?? null;
}

/** PAY-14 / HTL-10: refund amount for a cancellation made now. */
export function calculateCancellationRefund(
  totalAmountCents: number,
  tiers: CancellationTierLike[],
  daysBeforeCheckIn: number,
): RefundCalculation {
  if (!Number.isInteger(totalAmountCents) || totalAmountCents < 0) {
    throw new BadRequestException('totalAmountCents must be a non-negative integer.');
  }
  const tier = selectCancellationTier(tiers, daysBeforeCheckIn);
  if (!tier) {
    return { percent: 0, amountCents: 0, tier: null };
  }
  const amountCents = Math.round((totalAmountCents * tier.refundPercent) / 100);
  return { percent: tier.refundPercent, amountCents, tier };
}
