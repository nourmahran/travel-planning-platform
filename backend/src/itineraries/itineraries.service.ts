
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
import { CloneItineraryDto } from './dto/clone-itinerary.dto';
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
    return this.findOneByNestedId(
      'days.activities._id',
      activityId,
      'Activity',
      ownerId,
    );
  }

  /** Finds the itinerary that holds a budget entry, for the /budgets/:id routes. */
  async findOneByBudget(
    ownerId: string,
    budgetId: string,
  ): Promise<ItineraryDocument> {
    return this.findOneByNestedId(
      'days.budgets._id',
      budgetId,
      'Budget entry',
      ownerId,
    );
  }

  /** Finds the itinerary that holds a transport cost. */
  async findOneByTransportCost(
    ownerId: string,
    costId: string,
  ): Promise<ItineraryDocument> {
    return this.findOneByNestedId(
      'transportCosts._id',
      costId,
      'Transport cost',
      ownerId,
    );
  }

  private async findOneByNestedId(
    path: string,
    id: string,
    label: string,
    ownerId: string,
  ): Promise<ItineraryDocument> {
    const itinerary = await this.itineraryModel
      .findOne({ [path]: new Types.ObjectId(id) })
      .exec();

    if (!itinerary) {
      throw new NotFoundException(`${label} not found`);
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

  /**
   * ITN-21, ITN-22. Copies a public itinerary, or one the caller owns, into a
   * new private itinerary. Every subdocument is rebuilt so the copy shares no
   * ids with the source, and the source keeps the author attribution.
   */
  async clone(
    ownerId: string,
    sourceId: string,
    dto: CloneItineraryDto,
  ): Promise<ItineraryDocument> {
    const source = await this.itineraryModel.findById(sourceId).exec();

    if (!source) {
      throw new NotFoundException('Itinerary not found');
    }

    const owned = source.ownerId.toString() === ownerId;
    const shareable = source.visibility === 'public' && !source.isHidden;

    if (!owned && !shareable) {
      // A private itinerary must not reveal that it exists.
      throw new NotFoundException('Itinerary not found');
    }

    const authorName =
      (await this.referenceData.userName(source.ownerId.toString())) ??
      'Unknown traveller';
    const startDate = dto.startDate
      ? this.parseStartDate(dto.startDate).toFormat('yyyy-MM-dd')
      : source.startDate;

    const days = source.days.map((day) => ({
      dayNumber: day.dayNumber,
      date: day.date,
      cityId: day.cityId,
      notes: day.notes,
      activities: (day.activities ?? []).map((activity) => ({
        title: activity.title,
        attractionId: activity.attractionId,
        startTime: activity.startTime,
        durationMinutes: activity.durationMinutes,
        notes: activity.notes,
        cost: activity.cost,
        images: (activity.images ?? []).map((image) => ({
          url: image.url,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
        })),
      })),
      budgets: (day.budgets ?? []).filter((budget) => !budget.bookingId).map((budget) => ({
        category: budget.category,
        amount: budget.amount,
        currency: budget.currency,
        note: budget.note,
      })),
    }));

    if (dto.startDate) {
      renumberDays(startDate, days);
    }

    const created = await this.itineraryModel.create({
      ownerId: new Types.ObjectId(ownerId),
      title: dto.title?.trim() || `Copy of ${source.title}`,
      countries: [...source.countries],
      startDate,
      currency: source.currency,
      visibility: DEFAULT_VISIBILITY,
      isHidden: false,
      days,
      transportCosts: (source.transportCosts ?? []).map((cost) => ({
        mode: cost.mode,
        fromCityId: cost.fromCityId,
        toCityId: cost.toCityId,
        amount: cost.amount,
        currency: cost.currency,
        date: cost.date,
        note: cost.note,
      })),
      clonedFrom: {
        itineraryId: source._id,
        authorId: source.ownerId,
        authorName,
        clonedAt: new Date(),
      },
      cloneCount: 0,
    });

    await this.itineraryModel
      .updateOne({ _id: source._id }, { $inc: { cloneCount: 1 } })
      .exec();

    return created;
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
