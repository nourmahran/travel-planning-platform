import { ConflictException } from '@nestjs/common';
import { BookingStatus } from './booking-status.enum';
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
} from './booking-state-machine';

const S = BookingStatus;

// The full 5×5 matrix written out by hand (GEN-11), independent of
// ALLOWED_TRANSITIONS, so a mistake in the implementation table is caught.
const ALLOWED_PAIRS: Array<[BookingStatus, BookingStatus]> = [
  [S.PENDING_PAYMENT, S.CONFIRMED],
  [S.PENDING_PAYMENT, S.EXPIRED],
  [S.CONFIRMED, S.COMPLETED],
  [S.CONFIRMED, S.CANCELLED],
];

const ALL = Object.values(BookingStatus);
const isAllowed = (from: BookingStatus, to: BookingStatus) =>
  ALLOWED_PAIRS.some(([f, t]) => f === from && t === to);

const ALL_PAIRS = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));
const FORBIDDEN_PAIRS = ALL_PAIRS.filter(([f, t]) => !isAllowed(f, t));

describe('booking state machine (GEN-11)', () => {
  it('covers all 25 status pairs', () => {
    expect(ALL).toHaveLength(5);
    expect(ALL_PAIRS).toHaveLength(25);
    expect(FORBIDDEN_PAIRS).toHaveLength(21);
  });

  it('has a transition entry for every status', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  describe.each(ALLOWED_PAIRS)('allowed: %s → %s', (from, to) => {
    it('canTransition returns true', () => {
      expect(canTransition(from, to)).toBe(true);
    });
    it('assertTransition does not throw', () => {
      expect(() => assertTransition(from, to)).not.toThrow();
    });
  });

  describe.each(FORBIDDEN_PAIRS)('forbidden: %s → %s', (from, to) => {
    it('canTransition returns false', () => {
      expect(canTransition(from, to)).toBe(false);
    });
    it('assertTransition throws 409 INVALID_STATUS_TRANSITION', () => {
      expect.assertions(3);
      try {
        assertTransition(from, to);
      } catch (e) {
        expect(e).toBeInstanceOf(ConflictException);
        expect((e as ConflictException).getStatus()).toBe(409);
        expect((e as ConflictException).getResponse()).toMatchObject({
          code: 'INVALID_STATUS_TRANSITION',
        });
      }
    });
  });

  it.each([S.COMPLETED, S.EXPIRED, S.CANCELLED])(
    '%s is a final state (no outgoing transitions)',
    (status) => {
      expect(ALLOWED_TRANSITIONS[status]).toEqual([]);
    },
  );

  it('rejects an unknown status value', () => {
    expect(canTransition('BOGUS' as BookingStatus, S.CONFIRMED)).toBe(false);
  });
});
