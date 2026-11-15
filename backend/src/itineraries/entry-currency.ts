import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import type {
  DailyRates,
  ExchangeRatesService,
} from '../currency/exchange-rates.service';
import type { ReferenceDataService } from '../reference-data/reference-data.service';

/**
 * ITN-14 and ITN-16: an entry records the currency its amount was entered in.
 * Every total is then stated in the itinerary currency, so a foreign amount is
 * multiplied by its rate before it joins a sum. `factors(currency)` returns that
 * multiplier; an entry with no currency (written before the field existed) is
 * already in the itinerary currency.
 */
export type EntryFactors = (currency?: string) => number;

type EntrySource = {
  currency: string;
  days?: { budgets?: { currency?: string }[] }[];
  transportCosts?: { currency?: string }[];
};

export function identityFactors(): EntryFactors {
  return () => 1;
}

/**
 * The currency an entry is written in: the one the client sent, or the
 * itinerary currency when it sent none. Rejects a code the reference dataset
 * cannot serve, so a stored entry always has a rate behind it.
 */
export async function resolveEntryCurrency(
  currency: string | undefined,
  fallback: string,
  referenceData: ReferenceDataService,
): Promise<string> {
  if (currency === undefined) {
    return fallback;
  }

  const code = currency.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new BadRequestException('currency must be a 3-letter ISO code');
  }

  const supported = await referenceData.displayCurrencies();

  if (!supported.includes(code)) {
    throw new BadRequestException(
      `Unsupported currency: ${code}. Valid codes: ${supported.join(', ')}`,
    );
  }

  return code;
}

/** The distinct currencies the entries use, ignoring the itinerary's own. */
export function foreignEntryCurrencies(itinerary: EntrySource): string[] {
  const home = itinerary.currency.trim().toUpperCase();
  const codes = new Set<string>();

  const consider = (currency?: string) => {
    const code = currency?.trim().toUpperCase();

    if (code && code !== home) {
      codes.add(code);
    }
  };

  for (const day of itinerary.days ?? []) {
    for (const budget of day.budgets ?? []) {
      consider(budget.currency);
    }
  }

  for (const cost of itinerary.transportCosts ?? []) {
    consider(cost.currency);
  }

  return [...codes].sort();
}

/**
 * Resolves one rate per foreign currency, reusing the daily table the caller
 * already needs. With no foreign entry nothing is fetched: the itinerary
 * currency factors to 1 and `rates` comes back null.
 */
export async function entryCurrencyFactors(
  itinerary: EntrySource,
  exchangeRates: ExchangeRatesService,
): Promise<{ factors: EntryFactors; rates: DailyRates | null }> {
  const home = itinerary.currency.trim().toUpperCase();
  const codes = foreignEntryCurrencies(itinerary);

  if (codes.length === 0) {
    return { factors: identityFactors(), rates: null };
  }

  const rates = await exchangeRates.getDailyRates();
  const table = new Map<string, number>([[home, 1]]);

  for (const code of codes) {
    table.set(code, await exchangeRates.rateBetween(code, home, rates));
  }

  return {
    factors: (currency?: string) => {
      const code = currency?.trim().toUpperCase();

      if (!code) {
        return 1;
      }

      const factor = table.get(code);

      if (factor === undefined) {
        throw new ServiceUnavailableException(
          `No exchange rate is available for ${code}`,
        );
      }

      return factor;
    },
    rates,
  };
}
