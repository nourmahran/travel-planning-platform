/** Rounds a money amount to 2 decimals, correcting binary float noise. */
export function roundAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
