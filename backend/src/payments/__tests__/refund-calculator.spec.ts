import {
  calculateRefund,
  daysRemaining,
  selectRefundPercent,
  validateTiers,
} from '../refund-calculator';

const DAY = 86_400_000;
const TIERS = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 0, refundPercent: 0 },
];

describe('PAY-03 refund calculator', () => {
  describe('selectRefundPercent (FLT-09 / HTL-10 tier rule)', () => {
    it.each([
      [40, 100],
      [30, 100],
      [29, 50],
      [7, 50],
      [6, 0],
      [0, 0],
    ])('%i days remaining -> %i%%', (days, expected) => {
      expect(selectRefundPercent(TIERS, days)).toBe(expected);
    });

    it('returns 0 when no tier applies', () => {
      expect(
        selectRefundPercent([{ daysBefore: 14, refundPercent: 80 }], 3),
      ).toBe(0);
    });

    it('returns 0 for empty tiers', () => {
      expect(selectRefundPercent([], 100)).toBe(0);
    });

    it('returns 0 for negative days (already started)', () => {
      expect(selectRefundPercent(TIERS, -1)).toBe(0);
    });

    it('does not depend on tier order', () => {
      expect(selectRefundPercent([...TIERS].reverse(), 29)).toBe(50);
    });
  });

  describe('validateTiers', () => {
    it.each([
      [
        [
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 7, refundPercent: 20 },
        ],
      ],
      [[{ daysBefore: -1, refundPercent: 50 }]],
      [[{ daysBefore: 1.5, refundPercent: 50 }]],
      [[{ daysBefore: 3, refundPercent: 101 }]],
      [[{ daysBefore: 3, refundPercent: -5 }]],
    ])('rejects invalid tiers %#', (tiers) => {
      expect(() => validateTiers(tiers)).toThrow(RangeError);
      expect(() => selectRefundPercent(tiers, 10)).toThrow(RangeError);
    });
  });

  describe('daysRemaining', () => {
    it('flight: counts full 24h periods (never rounds up)', () => {
      const now = new Date('2026-11-08T12:00:00Z');
      expect(
        daysRemaining(
          new Date(now.getTime() + 7 * DAY - 60_000),
          now,
          'flight',
        ),
      ).toBe(6);
      expect(
        daysRemaining(new Date(now.getTime() + 7 * DAY), now, 'flight'),
      ).toBe(7);
      expect(
        daysRemaining(new Date(now.getTime() - 3_600_000), now, 'flight'),
      ).toBe(-1);
    });

    it('hotel: counts calendar days in UTC across midnight', () => {
      const checkIn = new Date('2026-11-10T00:00:00Z');
      expect(
        daysRemaining(checkIn, new Date('2026-11-08T23:59:00Z'), 'hotel'),
      ).toBe(2);
      expect(
        daysRemaining(checkIn, new Date('2026-11-09T00:00:00Z'), 'hotel'),
      ).toBe(1);
      expect(
        daysRemaining(checkIn, new Date('2026-11-10T15:00:00Z'), 'hotel'),
      ).toBe(0);
    });
  });

  describe('calculateRefund', () => {
    const now = new Date('2026-11-08T12:00:00Z');

    it('applies the tier rule for user cancellations', () => {
      const r = calculateRefund({
        totalAmountMinor: 20000,
        tiers: TIERS,
        startsAt: new Date(now.getTime() + 10 * DAY),
        now,
        kind: 'flight',
        reason: 'UserCancellation',
      });
      expect(r).toEqual({ percent: 50, amountMinor: 10000, daysRemaining: 10 });
    });

    it.each(['ProviderCancellation', 'LatePayment'] as const)(
      '%s is always 100%% regardless of tiers',
      (reason) => {
        const r = calculateRefund({
          totalAmountMinor: 20000,
          tiers: [{ daysBefore: 0, refundPercent: 0 }],
          startsAt: new Date(now.getTime() + 1 * DAY),
          now,
          kind: 'hotel',
          reason,
        });
        expect(r.percent).toBe(100);
        expect(r.amountMinor).toBe(20000);
      },
    );

    it('rounds to the nearest minor unit (999 x 33% = 330)', () => {
      const r = calculateRefund({
        totalAmountMinor: 999,
        tiers: [{ daysBefore: 0, refundPercent: 33 }],
        startsAt: new Date(now.getTime() + 5 * DAY),
        now,
        kind: 'flight',
        reason: 'UserCancellation',
      });
      expect(r.amountMinor).toBe(330);
    });
  });
});
