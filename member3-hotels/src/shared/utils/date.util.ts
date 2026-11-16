import { BadRequestException } from '@nestjs/common';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Hotel stays are handled as calendar dates (YYYY-MM-DD), not instants, so a
 * reservation is never shifted by the server timezone. Check-in / check-out
 * times from the hotel policy are applied by the frontend for display.
 */

export function isValidISODateString(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function toUtcDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function parseISODate(value: string, field = 'date'): Date {
  if (!isValidISODateString(value)) {
    throw new BadRequestException(`${field} must be a valid date in YYYY-MM-DD format.`);
  }
  return toUtcDate(value);
}

export function formatISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today according to the server clock, in UTC. */
export function todayISO(): string {
  return formatISODate(new Date());
}

export function addDaysISO(value: string, days: number): string {
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatISODate(date);
}

/** Calendar days from `fromISO` to `toISO` (positive when `toISO` is later). */
export function differenceInCalendarDays(fromISO: string, toISO: string): number {
  return Math.round((toUtcDate(toISO).getTime() - toUtcDate(fromISO).getTime()) / MS_PER_DAY);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return differenceInCalendarDays(checkIn, checkOut);
}

/** Nights actually occupied: check-in day up to the day before check-out. */
export function enumerateNights(checkIn: string, checkOut: string): string[] {
  const nights = nightsBetween(checkIn, checkOut);
  return Array.from({ length: Math.max(nights, 0) }, (_, index) => addDaysISO(checkIn, index));
}

export function eachDateInclusive(fromISO: string, toISO: string): string[] {
  const days = differenceInCalendarDays(fromISO, toISO);
  return Array.from({ length: Math.max(days + 1, 0) }, (_, index) => addDaysISO(fromISO, index));
}

/** Inclusive range overlap, safe because ISO dates compare lexicographically. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function isPastISODate(value: string, today = todayISO()): boolean {
  return value < today;
}

export interface StayValidationOptions {
  maxNights: number;
}

export interface ValidatedStay {
  checkIn: string;
  checkOut: string;
  nights: number;
}

export function assertValidStay(
  checkIn: string,
  checkOut: string,
  options: StayValidationOptions,
): ValidatedStay {
  parseISODate(checkIn, 'checkIn');
  parseISODate(checkOut, 'checkOut');

  if (checkIn < todayISO()) {
    throw new BadRequestException('checkIn cannot be in the past.');
  }
  if (checkOut <= checkIn) {
    throw new BadRequestException('checkOut must be after checkIn.');
  }

  const nights = nightsBetween(checkIn, checkOut);
  if (nights > options.maxNights) {
    throw new BadRequestException(`A stay cannot exceed ${options.maxNights} nights.`);
  }

  return { checkIn, checkOut, nights };
}
