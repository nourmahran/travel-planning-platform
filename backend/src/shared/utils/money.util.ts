import { BadRequestException } from '@nestjs/common';

/**
 * All monetary values in this module are integers in minor units (cents) of
 * the single platform currency (PAY-18). Floats are never used for money.
 */
export function assertNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${field} must be a non-negative integer amount in minor units.`);
  }
  return value;
}

export function sumMinorUnits(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function centsToMajor(cents: number): number {
  return Math.round(cents) / 100;
}

export function majorToCents(amount: number): number {
  return Math.round(amount * 100);
}
