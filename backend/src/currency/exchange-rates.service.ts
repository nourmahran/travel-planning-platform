import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { FxRatesClient, FxRatesError } from './fxrates.client';
import {
  ExchangeRate,
  type ExchangeRateDocument,
} from './schemas/exchange-rate.schema';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { roundAmount } from '../common/utils/round-amount';

export type RateSource = 'live' | 'cached' | 'stale';

export type DailyRates = {
  date: string;
  base: string;
  rates: Record<string, number>;
  source: RateSource;
};

export type ConversionResult = {
  amount: number;
  from: string;
  to: string;
  rate: number;
  convertedAmount: number;
  rateDate: string;
  rateSource: RateSource;
};

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly rateModel: Model<ExchangeRateDocument>,
    private readonly client: FxRatesClient,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * Today's cached table (UTC date), fetched and upserted once per day. When
   * the API fails the newest cached document is served with source 'stale';
   * with no document at all the caller gets 503 rather than a made-up rate.
   */
  async getDailyRates(): Promise<DailyRates> {
    const today = new Date().toISOString().slice(0, 10);
    const cached = await this.rateModel.findOne({ date: today }).exec();

    if (cached) {
      return this.toDailyRates(cached, 'cached');
    }

    try {
      const fetched = await this.client.fetchLatest();
      const updated = await this.rateModel
        .findOneAndUpdate(
          { date: today },
          {
            $set: {
              date: today,
              base: 'USD',
              rates: fetched.rates,
              fetchedAt: new Date(),
              source: 'fxratesapi',
            },
          },
          { upsert: true, new: true },
        )
        .exec();

      if (!updated) {
        throw new FxRatesError('The rate document could not be stored');
      }

      return this.toDailyRates(updated, 'live');
    } catch (error) {
      const newest = await this.rateModel
        .findOne()
        .sort({ date: -1 })
        .exec();

      if (!newest) {
        this.logger.error(
          `No exchange rate available and the API failed: ${String(error)}`,
        );

        throw new ServiceUnavailableException(
          'Exchange rates are unavailable: the API failed and no cached rate exists yet',
        );
      }

      this.logger.warn(
        `Serving the exchange rates of ${newest.date} because the API failed`,
      );

      return this.toDailyRates(newest, 'stale');
    }
  }

  async convert(
    amount: number,
    from: string,
    to: string,
  ): Promise<ConversionResult> {
    const daily = await this.getDailyRates();

    return this.convertWith(amount, from, to, daily);
  }

  /** Conversion against an already-resolved table, so a report converts once. */
  async convertWith(
    amount: number,
    from: string,
    to: string,
    daily: DailyRates,
  ): Promise<ConversionResult> {
    const supported = await this.referenceData.displayCurrencies();
    const fromCode = this.normalizeCode(from, supported);
    const toCode = this.normalizeCode(to, supported);
    const rate =
      fromCode === toCode
        ? 1
        : this.crossRate(fromCode, toCode, daily.rates);

    return {
      amount,
      from: fromCode,
      to: toCode,
      rate,
      convertedAmount: roundAmount(amount * rate),
      rateDate: daily.date,
      rateSource: daily.source,
    };
  }

  private normalizeCode(code: string, supported: string[]): string {
    const value = code.trim().toUpperCase();

    if (!supported.includes(value)) {
      throw new BadRequestException(
        `Unsupported currency: ${value}. Valid codes: ${supported.join(', ')}`,
      );
    }

    return value;
  }

  /** rate = rates[to] / rates[from], with USD defined as 1. */
  private crossRate(
    from: string,
    to: string,
    rates: Record<string, number>,
  ): number {
    const fromRate = from === 'USD' ? 1 : rates[from];
    const toRate = to === 'USD' ? 1 : rates[to];

    if (!fromRate) {
      throw new BadRequestException(
        `The rate table has no rate for ${from}`,
      );
    }

    if (!toRate) {
      throw new BadRequestException(`The rate table has no rate for ${to}`);
    }

    return toRate / fromRate;
  }

  private toDailyRates(
    document: ExchangeRateDocument,
    source: RateSource,
  ): DailyRates {
    return {
      date: document.date,
      base: document.base,
      rates: document.rates,
      source,
    };
  }
}
