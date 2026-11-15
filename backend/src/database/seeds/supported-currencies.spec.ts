import { supportedCurrencies } from './supported-currencies';

describe('supported currency reference data', () => {
  it('includes the platform currency and removes duplicates', () => {
    expect(
      supportedCurrencies('eur, USD,eur', 'usd').map((c) => c.code),
    ).toEqual(['EUR', 'USD']);
  });

  it('rejects an invalid currency before writing to the database', () => {
    expect(() => supportedCurrencies('NOT_A_CURRENCY', 'USD')).toThrow(
      'Unsupported currency code',
    );
  });
});
