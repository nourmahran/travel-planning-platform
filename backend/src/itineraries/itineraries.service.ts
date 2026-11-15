
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';

import {
  Itinerary,
  type ItineraryDocument,
} from './schemas/itinerary.schema';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ListItinerariesDto, UpdateItineraryDto } from './dto/update-itinerary.dto';
import { toItinerarySummary } from './itinerary-summary';
import { DEFAULT_VISIBILITY, ITINERARY_LIMITS } from './itinerary.constants';
import { renumberDays } from './days-and-dates';

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<ItineraryDocument>,
    private readonly referenceData: ReferenceDataService,
  ) {}

  async create(
    ownerId: string,
    dto: CreateItineraryDto,
  ): Promise<ItineraryDocument> {
    const countries = await this.resolveCountries(dto.countries);
    const startDate = this.parseStartDate(dto.startDate);

    if (startDate < DateTime.utc().startOf('day')) {
      throw new BadRequestException('startDate cannot be in the past');
    }

    const currency = await this.resolveCurrency(dto.currency, countries);

    return this.itineraryModel.create({
      ownerId: new Types.ObjectId(ownerId),
      title: dto.title.trim(),
      countries,
      startDate: startDate.toFormat('yyyy-MM-dd'),
      currency,
      visibility: DEFAULT_VISIBILITY,
      isHidden: false,
      days: [],
      transportCosts: [],
      cloneCount: 0,
    });
  }

  async list(ownerId: string, query: ListItinerariesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? ITINERARY_LIMITS.defaultLimit;

    if (page < 1 || limit < 1 || limit > ITINERARY_LIMITS.maxLimit) {
      throw new BadRequestException(
        `page must be at least 1 and limit between 1 and ${ITINERARY_LIMITS.maxLimit}`,
      );
    }

    const filter = { ownerId: new Types.ObjectId(ownerId) };

    const [documents, total] = await Promise.all([
      this.itineraryModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.itineraryModel.countDocuments(filter).exec(),
    ]);

    return {
      items: documents.map((document) => toItinerarySummary(document)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(ownerId: string, id: string): Promise<ItineraryDocument> {
    const itinerary = await this.itineraryModel.findById(id).exec();

    if (!itinerary) {
      throw new NotFoundException('Itinerary not found');
    }

    this.assertOwner(itinerary, ownerId);

    return itinerary;
  }

  /** Finds the itinerary that holds an activity, for the /activities/:id routes. */
  async findOneByActivity(
    ownerId: string,
    activityId: string,
  ): Promise<ItineraryDocument> {
    const itinerary = await this.itineraryModel
      .findOne({ 'days.activities._id': new Types.ObjectId(activityId) })
      .exec();

    if (!itinerary) {
      throw new NotFoundException('Activity not found');
    }

    this.assertOwner(itinerary, ownerId);

    return itinerary;
  }

  private assertOwner(
    itinerary: ItineraryDocument,
    ownerId: string,
  ): void {
    if (itinerary.ownerId.toString() !== ownerId) {
      throw new ForbiddenException('You do not own this itinerary');
    }
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateItineraryDto,
  ): Promise<ItineraryDocument> {
    const itinerary = await this.findOne(ownerId, id);

    if (dto.countries) {
      const countries = await this.resolveCountries(dto.countries);
      await this.assertDayCitiesStayInside(itinerary, countries);
      itinerary.countries = countries;
    }

    if (dto.currency) {
      itinerary.currency = await this.resolveCurrency(
        dto.currency,
        itinerary.countries,
      );
    }

    if (dto.startDate) {
      itinerary.startDate = this.parseStartDate(dto.startDate).toFormat(
        'yyyy-MM-dd',
      );

      renumberDays(itinerary.startDate, itinerary.days);
    }

    if (dto.title !== undefined) {
      itinerary.title = dto.title.trim();
    }

    if (dto.visibility !== undefined) {
      itinerary.visibility = dto.visibility;
    }

    await itinerary.save();

    return itinerary;
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const itinerary = await this.findOne(ownerId, id);

    await itinerary.deleteOne();
  }

  private async resolveCountries(countries: string[]): Promise<string[]> {
    const normalized = [
      ...new Set(countries.map((country) => country.trim().toUpperCase())),
    ];
    const found = await this.referenceData.countryCodes(normalized);
    const missing = normalized.filter((code) => !found.includes(code));

    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown country codes: ${missing.join(', ')}`,
      );
    }

    return normalized;
  }

  private parseStartDate(value: string): DateTime {
    const date = DateTime.fromISO(value, { zone: 'utc' });

    if (!date.isValid || date.toFormat('yyyy-MM-dd') !== value) {
      throw new BadRequestException(
        'startDate must be a valid calendar date (YYYY-MM-DD)',
      );
    }

    return date;
  }

  private async resolveCurrency(
    currency: string | undefined,
    countries: string[],
  ): Promise<string> {
    const supported = await this.referenceData.displayCurrencies();

    if (currency) {
      const code = currency.trim().toUpperCase();

      if (!supported.includes(code)) {
        throw new BadRequestException(
          `Unsupported currency: ${code}. Valid codes: ${supported.join(', ')}`,
        );
      }

      return code;
    }

    const fallback = await this.referenceData.currencyOfCountry(countries[0]);

    if (!fallback) {
      throw new BadRequestException(
        'currency is required: the first country has no currency in the reference data',
      );
    }

    return fallback;
  }

  private async assertDayCitiesStayInside(
    itinerary: ItineraryDocument,
    countries: string[],
  ): Promise<void> {
    const cityIds = [...new Set(itinerary.days.map((day) => day.cityId))];

    if (cityIds.length === 0) {
      return;
    }

    const allowed = await this.referenceData.citiesInCountries(countries);
    const allowedIds = new Set(allowed.map((city) => city.city_id));
    const orphaned = cityIds.filter((cityId) => !allowedIds.has(cityId));

    if (orphaned.length > 0) {
      throw new BadRequestException(
        `These day cities are outside the selected countries: ${orphaned.join(', ')}`,
      );
    }
  }
}
