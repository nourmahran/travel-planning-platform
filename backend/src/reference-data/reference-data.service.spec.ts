import type { Connection } from 'mongoose';

import { ReferenceDataService } from './reference-data.service';

/**
 * ITN-14: the display list is the union of what the country rows carry and
 * what SUPPORTED_CURRENCIES declares, so a currency the dataset has no country
 * for is still usable. An unset variable collapses to the country list alone.
 */
function serviceWith(stored: string[]): ReferenceDataService {
  const connection = {
    db: {
      collection: () => ({
        distinct: jest.fn().mockResolvedValue(stored),
      }),
    },
  } as unknown as Connection;

  return new ReferenceDataService(connection);
}

describe('ReferenceDataService.displayCurrencies', () => {
  const original = process.env.SUPPORTED_CURRENCIES;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SUPPORTED_CURRENCIES;
    } else {
      process.env.SUPPORTED_CURRENCIES = original;
    }
  });

  it('unions the country currencies with SUPPORTED_CURRENCIES', async () => {
    process.env.SUPPORTED_CURRENCIES = ' usd , cad,,EUR ';

    const currencies = await serviceWith(['EGP', 'AED', 'USD']).displayCurrencies();

    expect(currencies).toEqual(['AED', 'CAD', 'EGP', 'EUR', 'USD']);
  });

  it('is the country list alone when the variable is unset', async () => {
    delete process.env.SUPPORTED_CURRENCIES;

    const currencies = await serviceWith(['EGP', 'AED']).displayCurrencies();

    expect(currencies).toEqual(['AED', 'EGP']);
  });

  it('ignores entries that are not three-letter codes', async () => {
    process.env.SUPPORTED_CURRENCIES = 'CAD,C,EURO,1AB,$';

    const currencies = await serviceWith(['EGP']).displayCurrencies();

    expect(currencies).toEqual(['CAD', 'EGP']);
  });

  it('does not duplicate a code the country rows already carry', async () => {
    process.env.SUPPORTED_CURRENCIES = 'EGP,EGP';

    const currencies = await serviceWith(['EGP']).displayCurrencies();

    expect(currencies).toEqual(['EGP']);
  });
});
