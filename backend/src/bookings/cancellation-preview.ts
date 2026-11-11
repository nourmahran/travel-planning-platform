import type { CancellationTier } from '../airlines/schemas/airline.schema';

export function cancellationPreview(
  totalPrice: number,
  departureTimeUtc: Date,
  tiers: readonly CancellationTier[],
  now = new Date(),
) {
  if (departureTimeUtc <= now) throw new Error('Flight has departed');
  const daysRemaining = Math.floor(
    (departureTimeUtc.getTime() - now.getTime()) / 86_400_000,
  );
  const eligible = tiers
    .filter((tier) => tier.daysBefore <= daysRemaining)
    .sort((a, b) => b.daysBefore - a.daysBefore)[0];
  const refundPercent = eligible?.refundPercent ?? 0;
  return {
    daysRemaining,
    refundPercent,
    refundAmount: Math.round(((totalPrice * refundPercent) / 100) * 100) / 100,
  };
}
