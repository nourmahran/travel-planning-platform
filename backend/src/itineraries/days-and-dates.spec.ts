import { addDays, isCalendarDate, nextDate, renumberDays } from './days-and-dates';

describe('days-and-dates', () => {
  describe('nextDate', () => {
    it('returns the start date for the first day', () => {
      expect(nextDate('2026-11-20', 1)).toBe('2026-11-20');
    });

    it('crosses a month boundary', () => {
      expect(nextDate('2026-11-29', 3)).toBe('2026-12-01');
    });

    it('crosses a year boundary', () => {
      expect(nextDate('2026-12-30', 3)).toBe('2027-01-01');
    });

    it('respects a leap day', () => {
      expect(nextDate('2028-02-28', 2)).toBe('2028-02-29');
    });
  });

  describe('renumberDays', () => {
    it('numbers from 1 and rewrites every date', () => {
      const days = [
        { dayNumber: 4, date: 'stale' },
        { dayNumber: 9, date: 'stale' },
      ];

      expect(renumberDays('2026-11-20', days)).toEqual([
        { dayNumber: 1, date: '2026-11-20' },
        { dayNumber: 2, date: '2026-11-21' },
      ]);
    });

    it('accepts an empty itinerary', () => {
      expect(renumberDays('2026-11-20', [])).toEqual([]);
    });
  });

  describe('isCalendarDate', () => {
    it('rejects an impossible date', () => {
      expect(isCalendarDate('2027-02-30')).toBe(false);
    });

    it('accepts a real date', () => {
      expect(isCalendarDate('2027-02-28')).toBe(true);
    });

    it('rejects a non-ISO string', () => {
      expect(isCalendarDate('20/11/2026')).toBe(false);
    });
  });

  describe('addDays', () => {
    it('moves to the next day for a check-out date', () => {
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    });
  });
});
