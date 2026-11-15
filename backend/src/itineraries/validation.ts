/** HH:mm in 24-hour time, the format stored on an activity. */
export function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * A non-negative amount with at most two decimals. The tolerance absorbs
 * binary noise such as 0.1 + 0.2 while still rejecting 1.005.
 */
export function isMoney(value: number): boolean {
  if (!Number.isFinite(value) || value < 0) {
    return false;
  }

  const cents = Math.round(value * 100);

  return Math.abs(cents / 100 - value) < 1e-9;
}
