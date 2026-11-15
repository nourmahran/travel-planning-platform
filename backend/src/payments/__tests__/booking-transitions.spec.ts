import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  allowedFromStatuses,
  assertPlatformCurrency,
  assertTransition,
  BookingStatus,
  canTransition,
  fromMinorUnits,
  getBookingHoldMinutes,
  getPlatformCurrency,
  percentOf,
  toMinorUnits,
} from '../../common/booking';

const S = BookingStatus;
const ALLOWED_PAIRS: Array<[BookingStatus, BookingStatus]> = [
  [S.PendingPayment, S.Confirmed],
  [S.PendingPayment, S.Expired],
  [S.Confirmed, S.Completed],
  [S.Confirmed, S.Cancelled],
];
const isAllowed = (from: BookingStatus, to: BookingStatus) =>
  ALLOWED_PAIRS.some(([f, t]) => f === from && t === to);

describe('GEN-11 booking transitions', () => {
  const all = Object.values(BookingStatus);
  const pairs = all.flatMap((from) => all.map((to) => [from, to] as const));

  it('covers all 25 status combinations', () => {
    expect(pairs).toHaveLength(25);
  });

  it.each(pairs)('%s -> %s', (from, to) => {
    if (isAllowed(from, to)) {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    } else {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(ConflictException);
      expect(() => assertTransition(from, to)).toThrow(
        `Invalid booking status transition: ${from} -> ${to}`,
      );
    }
  });

  it('allowedFromStatuses returns the predecessor statuses', () => {
    expect(allowedFromStatuses(S.Confirmed)).toEqual([S.PendingPayment]);
    expect(allowedFromStatuses(S.Expired)).toEqual([S.PendingPayment]);
    expect(allowedFromStatuses(S.Cancelled)).toEqual([S.Confirmed]);
    expect(allowedFromStatuses(S.Completed)).toEqual([S.Confirmed]);
    expect(allowedFromStatuses(S.PendingPayment)).toEqual([]);
  });
});

describe('PAY-04 money helpers', () => {
  it('converts to and from minor units', () => {
    expect(toMinorUnits(199.99)).toBe(19999);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(toMinorUnits(1.005)).toBe(101);
    expect(toMinorUnits(0)).toBe(0);
    expect(fromMinorUnits(19999)).toBe(199.99);
  });

  it('computes percentages on integers', () => {
    expect(percentOf(999, 33)).toBe(330);
    expect(percentOf(10000, 50)).toBe(5000);
    expect(percentOf(10000, 0)).toBe(0);
  });

  it.each([
    () => toMinorUnits(-1),
    () => toMinorUnits(Number.NaN),
    () => toMinorUnits(Number.POSITIVE_INFINITY),
    () => fromMinorUnits(1.5),
    () => fromMinorUnits(-5),
    () => percentOf(10.5, 10),
    () => percentOf(100, 101),
    () => percentOf(100, -1),
  ])('rejects invalid input %#', (fn) => {
    expect(fn).toThrow(RangeError);
  });
});

describe('PAY-04 platform currency', () => {
  const cfg = (values: Record<string, string | undefined>) => ({
    get: <T>(key: string) => values[key] as T | undefined,
  });

  it('defaults to usd and lowercases', () => {
    expect(getPlatformCurrency(cfg({}))).toBe('usd');
    expect(getPlatformCurrency(cfg({ PLATFORM_CURRENCY: 'EUR' }))).toBe('eur');
  });

  it('rejects invalid and zero-decimal currencies', () => {
    expect(() =>
      getPlatformCurrency(cfg({ PLATFORM_CURRENCY: 'dollars' })),
    ).toThrow();
    expect(() =>
      getPlatformCurrency(cfg({ PLATFORM_CURRENCY: 'jpy' })),
    ).toThrow();
  });

  it('assertPlatformCurrency only accepts the platform currency', () => {
    expect(() => assertPlatformCurrency('USD', 'usd')).not.toThrow();
    expect(() => assertPlatformCurrency('egp', 'usd')).toThrow(
      BadRequestException,
    );
    expect(() => assertPlatformCurrency('', 'usd')).toThrow(
      BadRequestException,
    );
  });

  it('reads the hold duration (default 10 minutes, FLT-22/HTL-18)', () => {
    expect(getBookingHoldMinutes(cfg({}))).toBe(10);
    expect(getBookingHoldMinutes(cfg({ BOOKING_HOLD_MINUTES: '15' }))).toBe(15);
    expect(() =>
      getBookingHoldMinutes(cfg({ BOOKING_HOLD_MINUTES: '0' })),
    ).toThrow();
  });
});
