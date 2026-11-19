import { BadRequestException } from '@nestjs/common';
import {
  calculateCancellationRefund,
  normalizeCancellationTiers,
  selectCancellationTier,
} from './refund-policy.util';

const tiers = normalizeCancellationTiers([
  { minDaysBeforeCheckIn: 0, refundPercent: 0 },
  { minDaysBeforeCheckIn: 7, refundPercent: 100 },
  { minDaysBeforeCheckIn: 3, refundPercent: 50 },
]);

describe('refund-policy.util', () => {
  it('orders tiers from the strictest threshold', () => {
    expect(tiers.map((tier) => tier.minDaysBeforeCheckIn)).toEqual([7, 3, 0]);
  });

  it('requires a 0-day tier and unique thresholds', () => {
    expect(() => normalizeCancellationTiers([{ minDaysBeforeCheckIn: 3, refundPercent: 50 }])).toThrow(
      BadRequestException,
    );
    expect(() =>
      normalizeCancellationTiers([
        { minDaysBeforeCheckIn: 3, refundPercent: 50 },
        { minDaysBeforeCheckIn: 3, refundPercent: 20 },
        { minDaysBeforeCheckIn: 0, refundPercent: 0 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('selects the largest threshold that still applies', () => {
    expect(selectCancellationTier(tiers, 10)?.refundPercent).toBe(100);
    expect(selectCancellationTier(tiers, 7)?.refundPercent).toBe(100);
    expect(selectCancellationTier(tiers, 6)?.refundPercent).toBe(50);
    expect(selectCancellationTier(tiers, 3)?.refundPercent).toBe(50);
    expect(selectCancellationTier(tiers, 2)?.refundPercent).toBe(0);
    expect(selectCancellationTier(tiers, 0)?.refundPercent).toBe(0);
  });

  it('calculates the refund in minor units with integer rounding', () => {
    expect(calculateCancellationRefund(24000, tiers, 30)).toEqual(
      expect.objectContaining({ percent: 100, amountCents: 24000 }),
    );
    expect(calculateCancellationRefund(24000, tiers, 5)).toEqual(
      expect.objectContaining({ percent: 50, amountCents: 12000 }),
    );
    expect(calculateCancellationRefund(24001, tiers, 5).amountCents).toBe(12001);
    expect(calculateCancellationRefund(24000, tiers, 1).amountCents).toBe(0);
  });
});
