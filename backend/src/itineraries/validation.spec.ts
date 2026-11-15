import { isClockTime, isMoney } from './validation';

describe('validation', () => {
  describe('isClockTime', () => {
    it.each(['00:00', '09:05', '13:30', '23:59'])('accepts %s', (value) => {
      expect(isClockTime(value)).toBe(true);
    });

    it.each(['24:00', '9:05', '09:60', '09:5', '09:05:00', 'nine', ''])(
      'rejects %s',
      (value) => {
        expect(isClockTime(value)).toBe(false);
      },
    );
  });

  describe('isMoney', () => {
    it('accepts zero and whole amounts', () => {
      expect(isMoney(0)).toBe(true);
      expect(isMoney(120)).toBe(true);
    });

    it('accepts at most two decimals', () => {
      expect(isMoney(12.34)).toBe(true);
      expect(isMoney(0.05)).toBe(true);
    });

    it('rejects three decimals', () => {
      expect(isMoney(12.345)).toBe(false);
      expect(isMoney(1.005)).toBe(false);
    });

    it('rejects negative and non-finite amounts', () => {
      expect(isMoney(-1)).toBe(false);
      expect(isMoney(Number.NaN)).toBe(false);
      expect(isMoney(Number.POSITIVE_INFINITY)).toBe(false);
    });

    it('tolerates binary float noise', () => {
      expect(isMoney(0.1 + 0.2)).toBe(true);
    });
  });
});
