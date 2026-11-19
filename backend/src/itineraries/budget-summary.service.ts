import { Injectable } from '@nestjs/common';

import { ItinerariesService } from './itineraries.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ExchangeRatesService } from '../currency/exchange-rates.service';
import {
  addCategories,
  dayCategoryTotals,
  emptyCategoryTotals,
  sumCategories,
  type CategoryTotals,
} from './budget-totals';
import { buildCityGroups, type CityGroup, type CityReference } from './city-groups';
import { dayList, transportCostList } from './subdocuments';
import { roundAmount } from '../common/utils/round-amount';
import { entryCurrencyFactors, type EntryFactors } from './entry-currency';
import type { DailyRates } from '../currency/exchange-rates.service';
import type {
  BudgetCityGroupSummary,
  BudgetDaySummary,
  BudgetSummary,
  BudgetTransportSummary,
  SummaryRateSource,
} from './budget-summary.dto';
import type { ItineraryDocument } from './schemas/itinerary.schema';

type CollectedDay = BudgetDaySummary & { categories: CategoryTotals };

type Collected = {
  days: CollectedDay[];
  groups: { group: CityGroup; categories: CategoryTotals }[];
  transport: {
    id: string;
    mode: string;
    fromCityId: string;
    toCityId: string;
    date?: string;
    currency: string;
    amount: number;
    /** The amount in the itinerary currency, before the display conversion. */
    normalized: number;
  }[];
  sourceCategories: CategoryTotals;
  sourceTransport: number;
};

type Conversion = {
  factor: number;
  rateDate: string | null;
  rateSource: SummaryRateSource;
};

@Injectable()
export class BudgetSummaryService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly referenceData: ReferenceDataService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  /**
   * ITN-14 and ITN-18: totals per category, day, city group and the whole
   * itinerary, with every figure converted once into the display currency.
   */
  async summary(
    ownerId: string,
    itineraryId: string,
    requestedCurrency?: string,
  ): Promise<BudgetSummary> {
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);
    const currency = await this.resolveCurrency(
      ownerId,
      requestedCurrency,
      itinerary.currency,
    );
    const { factors, rates } = await entryCurrencyFactors(
      itinerary,
      this.exchangeRates,
    );
    const collected = await this.collect(itinerary, factors);
    const conversion = await this.resolveConversion(
      itinerary.currency,
      currency,
      rates,
    );

    const convert = (amount: number) => roundAmount(amount * conversion.factor);
    const convertCategories = (categories: CategoryTotals): CategoryTotals => ({
      food: convert(categories.food),
      accommodation: convert(categories.accommodation),
      local_transport: convert(categories.local_transport),
      activities: convert(categories.activities),
    });

    const sourceGrandTotal =
      sumCategories(collected.sourceCategories) + collected.sourceTransport;

    return {
      itineraryId: String(itinerary._id),
      currency,
      sourceCurrency: itinerary.currency,
      rateDate: conversion.rateDate,
      rateSource: conversion.rateSource,
      totals: {
        categories: convertCategories(collected.sourceCategories),
        transport: convert(collected.sourceTransport),
        grandTotal: convert(sourceGrandTotal),
      },
      byDay: collected.days.map((day) => ({
        dayId: day.dayId,
        dayNumber: day.dayNumber,
        date: day.date,
        cityId: day.cityId,
        categories: convertCategories(day.categories),
        total: convert(sumCategories(day.categories)),
      })),
      byCityGroup: collected.groups.map(
        ({ group, categories }): BudgetCityGroupSummary => ({
          cityId: group.cityId,
          cityName: group.cityName,
          countryCode: group.countryCode,
          fromDay: group.fromDay,
          toDay: group.toDay,
          dayCount: group.toDay - group.fromDay + 1,
          dateFrom: group.dateFrom,
          dateTo: group.dateTo,
          categories: convertCategories(categories),
          total: convert(sumCategories(categories)),
        }),
      ),
      transportCosts: collected.transport.map(
        (cost): BudgetTransportSummary => ({
          id: cost.id,
          mode: cost.mode,
          fromCityId: cost.fromCityId,
          toCityId: cost.toCityId,
          date: cost.date,
          currency: cost.currency,
          amount: cost.amount,
          convertedAmount: convert(cost.normalized),
        }),
      ),
    };
  }

  private async collect(
    itinerary: ItineraryDocument,
    factors: EntryFactors,
  ): Promise<Collected> {
    const cities = new Map<string, CityReference>(
      (await this.referenceData.citiesInCountries(itinerary.countries)).map(
        (city) => [
          city.city_id,
          { name: city.name, countryCode: city.country_code },
        ],
      ),
    );

    const days = dayList(itinerary);
    const collectedDays = days.map((day) => ({
      dayId: String(day._id),
      dayNumber: day.dayNumber,
      date: day.date,
      cityId: day.cityId,
      categories: dayCategoryTotals(day, factors),
      total: 0,
    }));

    const groups = buildCityGroups(days, cities).map((group) => ({
      group,
      categories: collectedDays
        .filter((day) => group.days.includes(day.dayNumber))
        .reduce(
          (totals, day) => addCategories(totals, day.categories),
          emptyCategoryTotals(),
        ),
    }));

    const transport = transportCostList(itinerary).map((cost) => ({
      id: String(cost._id),
      mode: cost.mode,
      fromCityId: cost.fromCityId,
      toCityId: cost.toCityId,
      date: cost.date,
      currency: cost.currency?.trim().toUpperCase() ?? itinerary.currency,
      amount: cost.amount,
      normalized: cost.amount * factors(cost.currency),
    }));

    return {
      days: collectedDays,
      groups,
      transport,
      sourceCategories: collectedDays.reduce(
        (totals, day) => addCategories(totals, day.categories),
        emptyCategoryTotals(),
      ),
      sourceTransport: transport.reduce((sum, cost) => sum + cost.normalized, 0),
    };
  }

  private async resolveCurrency(
    ownerId: string,
    requestedCurrency: string | undefined,
    itineraryCurrency: string,
  ): Promise<string> {
    if (requestedCurrency) {
      return requestedCurrency.trim().toUpperCase();
    }

    const preferred = await this.referenceData.preferredCurrencyOf(ownerId);

    if (!preferred) {
      return itineraryCurrency;
    }

    const code = preferred.trim().toUpperCase();

    if (code === itineraryCurrency) {
      return code;
    }

    // The profile accepts any 3-letter code (Member 1's profile DTO), so a
    // preference the FX table cannot serve falls back instead of failing the
    // whole summary.
    const supported = await this.referenceData.displayCurrencies();

    return supported.includes(code) ? code : itineraryCurrency;
  }

  private async resolveConversion(
    sourceCurrency: string,
    targetCurrency: string,
    rates: DailyRates | null,
  ): Promise<Conversion> {
    if (sourceCurrency === targetCurrency) {
      return { factor: 1, rateDate: null, rateSource: 'same' };
    }

    const daily = rates ?? (await this.exchangeRates.getDailyRates());
    const factor = await this.exchangeRates.rateBetween(
      sourceCurrency,
      targetCurrency,
      daily,
    );

    return { factor, rateDate: daily.date, rateSource: daily.source };
  }
}
