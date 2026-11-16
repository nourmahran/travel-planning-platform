import { ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { ExchangeRatesService } from './exchange-rates.service';
import { FxRatesClient } from './fxrates.client';
import { ExchangeRate } from './schemas/exchange-rate.schema';
import { ReferenceDataService } from '../reference-data/reference-data.service';

const TODAY = new Date().toISOString().slice(0, 10);

type FakeRateDocument = {
  date: string;
  base: string;
  rates: Record<string, number>;
  fetchedAt: Date;
  source: string;
};

const document = (
  overrides: Partial<FakeRateDocument> = {},
): FakeRateDocument => ({
  date: TODAY,
  base: 'USD',
  rates: { USD: 1, EGP: 50, EUR: 0.9 },
  fetchedAt: new Date(),
  source: 'fxratesapi',
  ...overrides,
});

describe('ExchangeRatesService', () => {
  let service: ExchangeRatesService;
  let model: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let client: { fetchLatest: jest.Mock };
  let referenceData: { displayCurrencies: jest.Mock };

  const cachedDocument = (value: FakeRateDocument | null) => {
    model.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(value),
    });
  };

  beforeEach(async () => {
    model = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
    client = { fetchLatest: jest.fn() };
    referenceData = {
      displayCurrencies: jest.fn().mockResolvedValue(['EGP', 'EUR', 'USD']),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeRatesService,
        { provide: getModelToken(ExchangeRate.name), useValue: model },
        { provide: FxRatesClient, useValue: client },
        { provide: ReferenceDataService, useValue: referenceData },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get(ExchangeRatesService);
  });

  describe('getDailyRates', () => {
    it('returns today cache without calling the FX client', async () => {
      cachedDocument(document());

      const result = await service.getDailyRates();

      expect(result).toMatchObject({ date: TODAY, source: 'cached', base: 'USD' });
      expect(result.rates.EGP).toBe(50);
      expect(client.fetchLatest).not.toHaveBeenCalled();
    });

    it('fetches and upserts when today has no document', async () => {
      cachedDocument(null);
      client.fetchLatest.mockResolvedValue({
        base: 'USD',
        rates: { USD: 1, EGP: 51 },
      });
      model.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(document({ rates: { USD: 1, EGP: 51 } })),
      });

      const result = await service.getDailyRates();

      expect(client.fetchLatest).toHaveBeenCalledTimes(1);
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { date: TODAY },
        expect.objectContaining({
          $set: expect.objectContaining({ base: 'USD', rates: { USD: 1, EGP: 51 } }),
        }),
        { upsert: true, new: true },
      );
      expect(result).toMatchObject({ source: 'live', date: TODAY });
    });

    it('falls back to the newest cached document when the API fails', async () => {
      model.findOne
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(null),
        })
        .mockReturnValueOnce({
          sort: jest.fn().mockReturnValue({
            exec: jest
              .fn()
              .mockResolvedValue(document({ date: '2026-11-14', rates: { USD: 1, EGP: 49 } })),
          }),
        });
      client.fetchLatest.mockRejectedValue(new Error('network down'));

      const result = await service.getDailyRates();

      expect(result).toMatchObject({ source: 'stale', date: '2026-11-14' });
      expect(result.rates.EGP).toBe(49);
    });

    it('throws 503 when the API fails and no document exists', async () => {
      model.findOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
        .mockReturnValueOnce({
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        });
      client.fetchLatest.mockRejectedValue(new Error('network down'));

      await expect(service.getDailyRates()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('convert', () => {
    const daily = {
      date: TODAY,
      base: 'USD',
      rates: { USD: 1, EGP: 50, EUR: 0.9 },
      source: 'cached' as const,
    };

    it('returns the amount unchanged for the same currency', async () => {
      await expect(
        service.convertWith(120, 'EGP', 'EGP', daily),
      ).resolves.toMatchObject({ rate: 1, convertedAmount: 120 });
    });

    it('computes a cross rate through USD', async () => {
      const result = await service.convertWith(100, 'EGP', 'EUR', daily);

      expect(result.rate).toBeCloseTo(0.018, 6);
      expect(result.convertedAmount).toBe(1.8);
      expect(result).toMatchObject({ rateDate: TODAY, rateSource: 'cached' });
    });

    it('converts from USD using the table directly', async () => {
      await expect(
        service.convertWith(2, 'USD', 'EGP', daily),
      ).resolves.toMatchObject({ rate: 50, convertedAmount: 100 });
    });

    it('rejects a code that is not a display currency', async () => {
      await expect(
        service.convertWith(10, 'XYZ', 'EGP', daily),
      ).rejects.toThrow(/Unsupported currency: XYZ/);
    });

    it('rejects a display currency missing from the rate table', async () => {
      referenceData.displayCurrencies.mockResolvedValue(['EGP', 'EUR', 'USD', 'JPY']);

      await expect(
        service.convertWith(10, 'JPY', 'EGP', daily),
      ).rejects.toThrow(/no rate for JPY/);
    });

    it('rounds the converted amount to 2 decimals', async () => {
      const result = await service.convertWith(3, 'USD', 'EUR', {
        ...daily,
        rates: { USD: 1, EUR: 0.3333333 },
      });

      expect(result.convertedAmount).toBe(1);
    });
  });
});
