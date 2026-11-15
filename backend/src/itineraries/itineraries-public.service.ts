import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';

import { Itinerary, type ItineraryDocument } from './schemas/itinerary.schema';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { PublicSearchDto } from './dto/public-search.dto';
import { toItinerarySummary } from './itinerary-summary';
import { toPublicDetail } from './public-itinerary';
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
  ) {}

  /** ITN-20, ITN-21: public itineraries only, never private or hidden ones. */
  async search(query: PublicSearchDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? ITINERARY_LIMITS.defaultLimit;
    const sort: Record<string, -1> =
      query.sort === 'popular'
        ? { cloneCount: -1, updatedAt: -1 }
        : { updatedAt: -1 };

    const [documents, total] = await Promise.all([
      this.itineraryModel
        .find(this.buildFilter(query))
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.itineraryModel.countDocuments(this.buildFilter(query)).exec(),
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

    return toPublicDetail(
      itinerary,
      { id: authorId, name: names.get(authorId) ?? UNKNOWN_AUTHOR },
      originalId
        ? { id: originalId, name: names.get(originalId) ?? UNKNOWN_AUTHOR }
        : undefined,
      cities,
    );
  }

  private buildFilter(query: PublicSearchDto): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      visibility: 'public',
      isHidden: { $ne: true },
    };

    if (query.q) {
      filter.title = { $regex: escapeRegex(query.q), $options: 'i' };
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
