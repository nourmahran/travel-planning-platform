
import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';

import { escapeRegex } from '../common/utils/escape-regex';

export type CountryRecord = {
  code: string;
  name: string;
  currency: string;
};

export type CityRecord = {
  city_id: string;
  name: string;
  country_code: string;
};

export type AirportRecord = {
  iata_code: string;
  name: string;
  city_id: string;
  country_code: string;
  time_zone: string;
};

export type ListCitiesQuery = {
  country?: string;
  q?: string;
  page?: number;
  limit?: number;
};

@Injectable()
export class ReferenceDataService {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private get database(): NonNullable<Connection['db']> {
    const database = this.connection.db;

    if (!database) {
      throw new ServiceUnavailableException(
        'Database connection is unavailable',
      );
    }

    return database;
  }

  private get countries() {
    return this.database.collection<CountryRecord>('countries');
  }

  private get cities() {
    return this.database.collection<CityRecord>('cities');
  }

  private get airports() {
    return this.database.collection<AirportRecord>('airports');
  }

  async country(code: string): Promise<CountryRecord | null> {
    return this.countries.findOne({ code: code.toUpperCase() });
  }

  async countryCodes(codes: string[]): Promise<string[]> {
    if (codes.length === 0) {
      return [];
    }

    const documents = await this.countries
      .find({ code: { $in: codes.map((code) => code.toUpperCase()) } })
      .toArray();

    return documents.map((document: CountryRecord) => document.code);
  }

  async currencyOfCountry(code: string): Promise<string | null> {
    const document = await this.country(code);

    return document?.currency ?? null;
  }

  async city(id: string): Promise<CityRecord | null> {
    return this.cities.findOne({ city_id: id });
  }

  async citiesInCountries(codes: string[]): Promise<CityRecord[]> {
    if (codes.length === 0) {
      return [];
    }

    return this.cities
      .find({ country_code: { $in: codes.map((code) => code.toUpperCase()) } })
      .toArray();
  }

  async displayCurrencies(): Promise<string[]> {
    const currencies = await this.countries.distinct('currency');

    return currencies
      .filter((currency: unknown): currency is string => typeof currency === 'string')
      .sort();
  }

  /** The display currency the user chose, when the users collection has one. */
  async preferredCurrencyOf(userId: string): Promise<string | null> {    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }

    const user = await this.database
      .collection<{ preferredCurrency?: string }>('users')
      .findOne(
        { _id: new Types.ObjectId(userId) },
        { projection: { preferredCurrency: 1 } },
      );

    return typeof user?.preferredCurrency === 'string'
      ? user.preferredCurrency
      : null;
  }

  /** Public author names by id; email and other fields never leave this method. */
  async userNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));

    if (unique.length === 0) {
      return new Map();
    }

    const users = await this.database
      .collection<{ _id: Types.ObjectId; name?: string }>('users')
      .find(
        { _id: { $in: unique.map((id) => new Types.ObjectId(id)) } },
        { projection: { name: 1 } },
      )
      .toArray();

    return new Map(
      users.map((user) => [user._id.toString(), user.name ?? '']),
    );
  }

  async userName(userId: string): Promise<string | null> {
    const names = await this.userNames([userId]);
    const name = names.get(userId);

    return name ? name : null;
  }

  async airportsInCity(cityId: string): Promise<AirportRecord[]> {
    return this.airports.find({ city_id: cityId }).toArray();
  }

  async airport(iataCode: string): Promise<AirportRecord | null> {
    return this.airports.findOne({ iata_code: iataCode.toUpperCase() });
  }

  /** Country codes whose code or name matches the text, for the public keyword search. */
  async countriesMatching(text: string): Promise<string[]> {
    const pattern = { $regex: escapeRegex(text), $options: 'i' };
    const documents = await this.countries
      .find(
        { $or: [{ code: pattern }, { name: pattern }] },
        { projection: { code: 1, _id: 0 } },
      )
      .limit(50)
      .toArray();

    return documents.map((document: CountryRecord) => document.code);
  }

  /** City ids whose name matches the text, for the public keyword search. */
  async citiesMatching(text: string): Promise<string[]> {
    const documents = await this.cities
      .find(
        { name: { $regex: escapeRegex(text), $options: 'i' } },
        { projection: { city_id: 1, _id: 0 } },
      )
      .limit(200)
      .toArray();

    return documents.map((document: CityRecord) => document.city_id);
  }

  async listCities(query: ListCitiesQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter: Record<string, unknown> = {};

    if (query.country) {
      filter.country_code = query.country.toUpperCase();
    }

    if (query.q) {
      filter.name = { $regex: escapeRegex(query.q), $options: 'i' };
    }

    const [items, total] = await Promise.all([
      this.cities
        .find(filter)
        .project<CityRecord>({ _id: 0 })
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      this.cities.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
