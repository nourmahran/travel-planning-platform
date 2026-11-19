import { BadRequestException } from '@nestjs/common';
import {
  addDaysISO,
  assertValidStay,
  differenceInCalendarDays,
  enumerateNights,
  isValidISODateString,
  nightsBetween,
  rangesOverlap,
  todayISO,
} from './date.util';

describe('date.util', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValidISODateString('2026-12-01')).toBe(true);
    expect(isValidISODateString('2026-02-29')).toBe(false);
    expect(isValidISODateString('2026-13-01')).toBe(false);
    expect(isValidISODateString('01-12-2026')).toBe(false);
    expect(isValidISODateString(20261201)).toBe(false);
  });

  it('enumerates occupied nights without the check-out day', () => {
    expect(enumerateNights('2026-12-01', '2026-12-04')).toEqual([
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
    ]);
    expect(nightsBetween('2026-12-01', '2026-12-04')).toBe(3);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDaysISO('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(differenceInCalendarDays('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('detects inclusive range overlap', () => {
    expect(rangesOverlap('2026-12-01', '2026-12-05', '2026-12-05', '2026-12-08')).toBe(true);
    expect(rangesOverlap('2026-12-01', '2026-12-05', '2026-12-06', '2026-12-08')).toBe(false);
  });

  it('rejects past check-in, inverted stays and over-long stays', () => {
    const tomorrow = addDaysISO(todayISO(), 1);
    const dayAfter = addDaysISO(tomorrow, 1);

    expect(assertValidStay(tomorrow, dayAfter, { maxNights: 30 }).nights).toBe(1);
    expect(() => assertValidStay(addDaysISO(todayISO(), -1), dayAfter, { maxNights: 30 })).toThrow(
      BadRequestException,
    );
    expect(() => assertValidStay(tomorrow, tomorrow, { maxNights: 30 })).toThrow(BadRequestException);
    expect(() =>
      assertValidStay(tomorrow, addDaysISO(tomorrow, 31), { maxNights: 30 }),
    ).toThrow(BadRequestException);
  });
});
