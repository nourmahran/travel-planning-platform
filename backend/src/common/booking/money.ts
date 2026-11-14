/**
 * PAY-04 money helpers.
 *
 * Inside the payments module every amount is stored as an INTEGER number of
 * minor units (cents). Floating-point numbers cannot represent most decimal
 * fractions exactly (0.1 + 0.2 !== 0.3), so doing money math on integers keeps
 * totals and refund percentages exact. Booking services expose prices in major
 * units (e.g. 199.99); we convert once at the boundary with toMinorUnits().
 */

function assertNonNegativeFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}

/** 199.99 -> 19999. Rounds half-cents away (1.005 -> 101). */
export function toMinorUnits(amount: number): number {
  assertNonNegativeFinite(amount, 'amount');
  // toFixed(6) removes binary noise first: 1.005 * 100 = 100.49999999999999.
  return Math.round(Number((amount * 100).toFixed(6)));
}

/** 19999 -> 199.99 */
export function fromMinorUnits(minor: number): number {
  assertNonNegativeFinite(minor, 'minor');
  if (!Number.isInteger(minor)) {
    throw new RangeError('minor must be an integer');
  }
  return minor / 100;
}

/** Percentage of an integer amount, rounded to the nearest minor unit. */
export function percentOf(amountMinor: number, percent: number): number {
  assertNonNegativeFinite(amountMinor, 'amountMinor');
  assertNonNegativeFinite(percent, 'percent');
  if (!Number.isInteger(amountMinor)) {
    throw new RangeError('amountMinor must be an integer');
  }
  if (percent > 100) {
    throw new RangeError('percent must be between 0 and 100');
  }
  return Math.round((amountMinor * percent) / 100);
}
