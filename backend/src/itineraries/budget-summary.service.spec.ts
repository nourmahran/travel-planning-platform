import { Test, type TestingModule } from '@nestjs/testing';

import { BudgetSummaryService } from './budget-summary.service';
import { ItinerariesService } from './itineraries.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ExchangeRatesService } from '../currency/exchange-rates.service';

const OWNER = 'a'.repeat(24);
const ITINERARY_ID = 'c'.repeat(24);
const DAY_ID = [1, 2, 3].map((n) => String(n).repeat(24));

type FakeItinerary = {
  _id: string;
  ownerId: string;
  countries: string[];
  currency: string;
  days: {
    _id: string;
    dayNumber: number;
    date: string;
    cityId: string;
    activities: { cost?: number }[];
    budgets: { _id?: string; category: string; amount: number; currency?: string }[];
  }[];
  transportCosts: {
    _id: string;
    fromCityId: string;
    toCityId: string;
    amount: number;
    currency?: string;
    date?: string;
  }[];
};

const makeItinerary = (
  overrides: Partial<FakeItinerary> = {},
): FakeItinerary => ({
  _id: ITINERARY_ID,
  ownerId: OWNER,
  countries: ['EG'],
  currency: 'EGP',
  days: [
    {
      _id: DAY_ID[0],
      dayNumber: 1,
      date: '2026-11-20',
      cityId: 'cairo',
      activities: [{ cost: 40 }],
      budgets: [{ category: 'food', amount: 100 }],
    },
    {
      _id: DAY_ID[1],
      dayNumber: 2,
      date: '2026-11-21',
      cityId: 'cairo',
      activities: [],
      budgets: [{ category: 'accommodation', amount: 300 }],
    },
    {
      _id: DAY_ID[2],
      dayNumber: 3,
      date: '2026-11-22',
      cityId: 'luxor',
      activities: [{ cost: 50 }],
      budgets: [{ category: 'local_transport', amount: 20 }],
    },
  ],
  transportCosts: [
    {
      _id: '3'.repeat(24),
      fromCityId: 'cairo',
      toCityId: 'luxor',
      amount: 200,
      date: '2026-11-22',
    },
  ],
  ...overrides,
});

describe('BudgetSummaryService', () => {
  let service: BudgetSummaryService;
  let itineraries: { findOne: jest.Mock };
  let referenceData: {
    citiesInCountries: jest.Mock;
    preferredCurrencyOf: jest.Mock;
    displayCurrencies: jest.Mock;
  };
  let exchangeRates: {
    getDailyRates: jest.Mock;
    rateBetween: jest.Mock;
  };

  const dailyRates = {
    date: '2026-11-15',
    base: 'USD',
    rates: { USD: 1 },
    source: 'cached' as const,
  };

  const load = (itinerary: FakeItinerary = makeItinerary()) => {
    itineraries.findOne.mockResolvedValue(itinerary);

    return itinerary;
  };

  beforeEach(async () => {
    itineraries = { findOne: jest.fn() };
    referenceData = {
      citiesInCountries: jest.fn().mockResolvedValue([
        { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
        { city_id: 'luxor', name: 'Luxor', country_code: 'EG' },
      ]),
      preferredCurrencyOf: jest.fn().mockResolvedValue(null),
      displayCurrencies: jest
        .fn()
        .mockResolvedValue(['EGP', 'USD', 'EUR', 'GBP']),
    };
    exchangeRates = {
      getDailyRates: jest.fn().mockResolvedValue(dailyRates),
      rateBetween: jest.fn().mockResolvedValue(1.5),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetSummaryService,
        { provide: ItinerariesService, useValue: itineraries },
        { provide: ReferenceDataService, useValue: referenceData },
        { provide: ExchangeRatesService, useValue: exchangeRates },
      ],
    }).compile();

    service = module.get(BudgetSummaryService);
  });

  it('totals by category, day, city group and itinerary', async () => {
    load();

    const summary = await service.summary(OWNER, ITINERARY_ID);

    expect(summary).toMatchObject({
      itineraryId: ITINERARY_ID,
      currency: 'EGP',
      sourceCurrency: 'EGP',
      rateSource: 'same',
      rateDate: null,
    });
    expect(summary.totals.categories).toEqual({
      food: 100,
      accommodation: 300,
      local_transport: 20,
      activities: 90,
    });
    expect(summary.totals.transport).toBe(200);
    expect(summary.totals.grandTotal).toBe(710);
    expect(summary.byDay).toHaveLength(3);
    expect(summary.byDay[0]).toMatchObject({
      dayId: DAY_ID[0],
      total: 140,
      categories: { food: 100, activities: 40 },
    });
    expect(summary.byDay[2]).toMatchObject({
      total: 70,
      categories: { local_transport: 20, activities: 50 },
    });
    expect(exchangeRates.getDailyRates).not.toHaveBeenCalled();
  });

  it('converts foreign-currency entries before totalling them (ITN-14, ITN-16)', async () => {
    exchangeRates.rateBetween.mockImplementation(
      async (from: string, to: string) => (from === 'USD' && to === 'EGP' ? 50 : 1),
    );
    load(
      makeItinerary({
        days: [
          {
            _id: DAY_ID[0],
            dayNumber: 1,
            date: '2026-11-20',
            cityId: 'cairo',
            activities: [{ cost: 40 }],
            budgets: [
              { category: 'food', amount: 100, currency: 'EGP' },
              { category: 'food', amount: 10, currency: 'USD' },
            ],
          },
        ],
        transportCosts: [
          {
            _id: '3'.repeat(24),
            fromCityId: 'cairo',
            toCityId: 'cairo',
            amount: 20,
            currency: 'USD',
            date: '2026-11-20',
          },
        ],
      }),
    );

    const summary = await service.summary(OWNER, ITINERARY_ID, 'EGP');

    // 10 USD at 50 EGP per USD joins the 100 EGP entry.
    expect(summary.totals.categories.food).toBe(600);
    expect(summary.totals.transport).toBe(1000);
    expect(summary.totals.grandTotal).toBe(1640);
    expect(summary.transportCosts[0]).toMatchObject({
      currency: 'USD',
      amount: 20,
      convertedAmount: 1000,
    });
    expect(exchangeRates.getDailyRates).toHaveBeenCalledTimes(1);
  });

  it('groups consecutive days by city and keeps runs apart', async () => {    load();

    const { byCityGroup } = await service.summary(OWNER, ITINERARY_ID);

    expect(byCityGroup).toHaveLength(2);
    expect(byCityGroup[0]).toMatchObject({
      cityId: 'cairo',
      cityName: 'Cairo',
      fromDay: 1,
      toDay: 2,
      dayCount: 2,
      dateFrom: '2026-11-20',
      dateTo: '2026-11-21',
      total: 440,
      categories: { food: 100, accommodation: 300, activities: 40 },
    });
    expect(byCityGroup[1]).toMatchObject({
      cityId: 'luxor',
      fromDay: 3,
      toDay: 3,
      dayCount: 1,
      total: 70,
    });
  });

  it('lists transport costs separately and adds them to the grand total only', async () => {
    load();

    const summary = await service.summary(OWNER, ITINERARY_ID);

    expect(summary.transportCosts).toEqual([
      expect.objectContaining({
        fromCityId: 'cairo',
        toCityId: 'luxor',
        amount: 200,
        convertedAmount: 200,
      }),
    ]);
    expect(
      summary.totals.categories.food +
        summary.totals.categories.accommodation +
        summary.totals.categories.local_transport +
        summary.totals.categories.activities,
    ).toBe(510);
    expect(summary.totals.grandTotal).toBe(710);
  });

  it('returns zeros and empty lists for an itinerary without days', async () => {
    load(makeItinerary({ days: [], transportCosts: [] }));

    const summary = await service.summary(OWNER, ITINERARY_ID);

    expect(summary.totals).toEqual({
      categories: {
        food: 0,
        accommodation: 0,
        local_transport: 0,
        activities: 0,
      },
      transport: 0,
      grandTotal: 0,
    });
    expect(summary.byDay).toEqual([]);
    expect(summary.byCityGroup).toEqual([]);
    expect(summary.transportCosts).toEqual([]);
  });

  it('converts each category total once, not each entry', async () => {
    load(
      makeItinerary({
        days: [
          {
            _id: DAY_ID[0],
            dayNumber: 1,
            date: '2026-11-20',
            cityId: 'cairo',
            activities: [],
            budgets: [
              { category: 'food', amount: 0.05 },
              { category: 'food', amount: 0.05 },
            ],
          },
        ],
        transportCosts: [],
      }),
    );

    const summary = await service.summary(OWNER, ITINERARY_ID, 'USD');

    expect(summary.currency).toBe('USD');
    expect(summary.rateSource).toBe('cached');
    expect(summary.rateDate).toBe(dailyRates.date);
    // 0.1 * 1.5 = 0.15; converting each 0.05 separately would give 0.16.
    expect(summary.totals.categories.food).toBe(0.15);
    expect(exchangeRates.rateBetween).toHaveBeenCalledTimes(1);
  });

  it('rounds a converted total to 2 decimals', async () => {
    load(
      makeItinerary({
        days: [
          {
            _id: DAY_ID[0],
            dayNumber: 1,
            date: '2026-11-20',
            cityId: 'cairo',
            activities: [],
            budgets: [{ category: 'food', amount: 10.01 }],
          },
        ],
        transportCosts: [],
      }),
    );

    const summary = await service.summary(OWNER, ITINERARY_ID, 'USD');

    expect(summary.byDay[0].total).toBe(15.02);
  });

  it('defaults to the user preferred currency when no currency is asked', async () => {
    load();
    referenceData.preferredCurrencyOf.mockResolvedValue('USD');

    const summary = await service.summary(OWNER, ITINERARY_ID);

    expect(summary.currency).toBe('USD');
    expect(exchangeRates.getDailyRates).toHaveBeenCalled();
  });

  it('prefers the requested currency over the user preference', async () => {
    load();
    referenceData.preferredCurrencyOf.mockResolvedValue('USD');

    const summary = await service.summary(OWNER, ITINERARY_ID, 'eur');

    expect(summary.currency).toBe('EUR');
    expect(referenceData.preferredCurrencyOf).not.toHaveBeenCalled();
  });

  it('ignores a profile currency the FX table cannot serve', async () => {
    load();
    referenceData.preferredCurrencyOf.mockResolvedValue('CHF');

    const summary = await service.summary(OWNER, ITINERARY_ID);

    expect(summary.currency).toBe('EGP');
    expect(summary.rateSource).toBe('same');
    expect(exchangeRates.rateBetween).not.toHaveBeenCalled();
  });

  it('serves a supported currency the country list does not carry', async () => {
    // CAD is not in any country.currency row; SUPPORTED_CURRENCIES supplies it.
    load();
    referenceData.displayCurrencies.mockResolvedValue([
      'AED',
      'CAD',
      'EGP',
      'EUR',
      'GBP',
      'USD',
    ]);
    exchangeRates.rateBetween.mockResolvedValue(2.5);

    const summary = await service.summary(OWNER, ITINERARY_ID, 'cad');

    expect(summary.currency).toBe('CAD');
    expect(summary.sourceCurrency).toBe('EGP');
    expect(summary.totals.grandTotal).toBe(1775);
    expect(exchangeRates.rateBetween).toHaveBeenCalledWith(
      'EGP',
      'CAD',
      dailyRates,
    );
  });

  it('names the code and the entry ids when the rate table has no rate for it', async () => {
    const budgetId = '4'.repeat(24);

    load(
      makeItinerary({
        days: [
          {
            _id: DAY_ID[0],
            dayNumber: 1,
            date: '2026-11-20',
            cityId: 'cairo',
            activities: [],
            budgets: [
              { _id: budgetId, category: 'food', amount: 10, currency: 'CAD' },
            ],
          },
        ],
        transportCosts: [],
      }),
    );
    referenceData.displayCurrencies.mockResolvedValue([
      'AED',
      'CAD',
      'EGP',
      'USD',
    ]);

    await expect(
      service.summary(OWNER, ITINERARY_ID, 'EGP'),
    ).rejects.toThrow(/rate missing for CAD \(budget [0-9a-f]{24}\)/);
    await expect(service.summary(OWNER, ITINERARY_ID, 'EGP')).rejects.toThrow(
      budgetId,
    );
  });
});
