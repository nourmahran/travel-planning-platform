import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';

import { Itinerary, type ItineraryDocument } from './schemas/itinerary.schema';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { PublicSearchDto } from './dto/public-search.dto';
import { toItinerarySummary } from './itinerary-summary';
import { toPublicDetail } from './public-itinerary';
import { entryCurrencyFactors } from './entry-currency';
import { ExchangeRatesService } from '../currency/exchange-rates.service';
import { escapeRegex } from '../common/utils/escape-regex';
import { ITINERARY_LIMITS } from './itinerary.constants';
import type { CityReference } from './city-groups';

const UNKNOWN_AUTHOR = 'Unknown traveller';

@Injectable()
export class ItinerariesPublicService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<ItineraryDocument>,
    private readonly referenceData: ReferenceDataService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  /** ITN-20, ITN-21: public itineraries only, never private or hidden ones. */
  async search(query: PublicSearchDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? ITINERARY_LIMITS.defaultLimit;
    const sort: Record<string, -1> =
      query.sort === 'popular'
        ? { cloneCount: -1, updatedAt: -1 }
        : { updatedAt: -1 };
    const filter = await this.buildFilter(query);

    const [documents, total] = await Promise.all([
      this.itineraryModel
        .find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.itineraryModel.countDocuments(filter).exec(),
    ]);

    const names = await this.referenceData.userNames(
      documents.map((document) => document.ownerId.toString()),
    );

    return {
      items: documents.map((document) => {
        const authorId = document.ownerId.toString();

        return {
          ...toItinerarySummary(document),
          author: {
            id: authorId,
            name: names.get(authorId) ?? UNKNOWN_AUTHOR,
          },
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** ITN-21: a guest can read a public itinerary; totals are not exposed. */
  async detail(id: string) {
    const itinerary = await this.itineraryModel.findById(id).exec();

    if (
      !itinerary ||
      itinerary.visibility !== 'public' ||
      itinerary.isHidden
    ) {
      throw new NotFoundException('Itinerary not found');
    }

    const authorId = itinerary.ownerId.toString();
    const originalId = itinerary.clonedFrom?.authorId.toString();
    const names = await this.referenceData.userNames(
      originalId ? [authorId, originalId] : [authorId],
    );
    const cities = new Map<string, CityReference>(
      (await this.referenceData.citiesInCountries(itinerary.countries)).map(
        (city) => [
          city.city_id,
          { name: city.name, countryCode: city.country_code },
        ],
      ),
    );
    // ITN-14/ITN-16: an entry written in another currency joins the public
    // budget at its rate; without foreign entries no rate is fetched.
    const { factors } = await entryCurrencyFactors(
      itinerary,
      this.exchangeRates,
    );

    return toPublicDetail(
      itinerary,
      { id: authorId, name: names.get(authorId) ?? UNKNOWN_AUTHOR },
      originalId
        ? { id: originalId, name: names.get(originalId) ?? UNKNOWN_AUTHOR }
        : undefined,
      cities,
      factors,
    );
  }

  private async buildFilter(
    query: PublicSearchDto,
  ): Promise<Record<string, unknown>> {
    const filter: Record<string, unknown> = {
      visibility: 'public',
      isHidden: { $ne: true },
    };

    if (query.q) {
      // ITN-21: the keyword matches the title, a country or a city.
      const [countryCodes, cityIds] = await Promise.all([
        this.referenceData.countriesMatching(query.q),
        this.referenceData.citiesMatching(query.q),
      ]);
      const matches: Record<string, unknown>[] = [
        { title: { $regex: escapeRegex(query.q), $options: 'i' } },
      ];

      if (countryCodes.length > 0) {
        matches.push({ countries: { $in: countryCodes } });
      }

      if (cityIds.length > 0) {
        matches.push({ 'days.cityId': { $in: cityIds } });
      }

      filter.$or = matches;
    }

    if (query.country) {
      filter.countries = query.country.toUpperCase();
    }

    if (query.city) {
      filter['days.cityId'] = query.city;
    }

    if (query.authorId) {
      filter.ownerId = new Types.ObjectId(query.authorId);
    }

    if (
      query.minDays !== undefined &&
      query.maxDays !== undefined &&
      query.minDays > query.maxDays
    ) {
      throw new BadRequestException('minDays cannot be greater than maxDays');
    }

    const dayCount = { $size: { $ifNull: ['$days', []] } };
    const conditions: Record<string, unknown>[] = [];

    if (query.minDays !== undefined) {
      conditions.push({ $gte: [dayCount, query.minDays] });
    }

    if (query.maxDays !== undefined) {
      conditions.push({ $lte: [dayCount, query.maxDays] });
    }

    if (conditions.length === 1) {
      filter.$expr = conditions[0];
    } else if (conditions.length > 1) {
      filter.$expr = { $and: conditions };
    }

    return filter;
  }
}
