import { cancellationPreview } from './cancellation-preview';

const now = new Date('2026-11-11T12:00:00Z');
const tiers = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
  { daysBefore: 2, refundPercent: 20 },
];

describe('flight cancellation preview', () => {
  it('chooses the highest threshold that has been reached', () => {
    expect(
      cancellationPreview(400, new Date('2026-11-20T12:00:00Z'), tiers, now),
    ).toEqual({ daysRemaining: 9, refundPercent: 50, refundAmount: 200 });
  });

  it('returns zero when no threshold applies', () => {
    expect(
      cancellationPreview(400, new Date('2026-11-12T12:00:00Z'), tiers, now),
    ).toEqual({ daysRemaining: 1, refundPercent: 0, refundAmount: 0 });
  });

  it('does not allow cancellation at departure', () => {
    expect(() => cancellationPreview(400, now, tiers, now)).toThrow(
      'Flight has departed',
    );
  });
});
