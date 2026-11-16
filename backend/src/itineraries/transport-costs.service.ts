import { BadRequestException, Injectable } from '@nestjs/common';

import { ItinerariesService } from './itineraries.service';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto';
import { UpdateTransportCostDto } from './dto/update-transport-cost.dto';
import {
  requireTransportCost,
  transportCostList,
} from './subdocuments';
import { toTransportCostResponse } from './itinerary-detail';
import { resolveEntryCurrency } from './entry-currency';
import type { TransportCost } from './schemas/itinerary.schema';
import { isCalendarDate } from './days-and-dates';
import { isMoney } from './validation';
import { ReferenceDataService } from '../reference-data/reference-data.service';

type LegFields = {
  mode?: string;
  fromCityId: string;
  toCityId: string;
  amount?: number;
  date?: string;
};

@Injectable()
export class TransportCostsService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  async create(
    ownerId: string,
    itineraryId: string,
    dto: CreateTransportCostDto,
  ) {
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);

    this.assertFields(itinerary, dto);

    const currency = await resolveEntryCurrency(
      dto.currency,
      itinerary.currency,
      this.referenceData,
    );

    itinerary.transportCosts.push({
      mode: dto.mode.trim(),
      fromCityId: dto.fromCityId,
      toCityId: dto.toCityId,
      amount: dto.amount,
      currency,
      date: dto.date,
      note: dto.note?.trim(),
    } as TransportCost);

    await itinerary.save();

    const costs = transportCostList(itinerary);

    return toTransportCostResponse(
      costs[costs.length - 1],
      itinerary.currency,
    );
  }

  async update(
    ownerId: string,
    costId: string,
    dto: UpdateTransportCostDto,
  ) {
    const itinerary = await this.itineraries.findOneByTransportCost(
      ownerId,
      costId,
    );
    const cost = requireTransportCost(itinerary, costId);

    this.assertFields(itinerary, {
      mode: dto.mode ?? cost.mode,
      fromCityId: dto.fromCityId ?? cost.fromCityId,
      toCityId: dto.toCityId ?? cost.toCityId,
      amount: dto.amount,
      date: dto.date,
    });

    if (dto.mode !== undefined) {
      cost.mode = dto.mode.trim();
    }

    if (dto.fromCityId !== undefined) {
      cost.fromCityId = dto.fromCityId;
    }

    if (dto.toCityId !== undefined) {
      cost.toCityId = dto.toCityId;
    }

    if (dto.amount !== undefined) {
      cost.amount = dto.amount;
    }

    if (dto.currency !== undefined) {
      cost.currency = await resolveEntryCurrency(
        dto.currency,
        itinerary.currency,
        this.referenceData,
      );
    }

    if (dto.date !== undefined) {
      cost.date = dto.date || undefined;
    }

    if (dto.note !== undefined) {
      cost.note = dto.note.trim();
    }

    await itinerary.save();

    return toTransportCostResponse(cost, itinerary.currency);
  }

  async remove(ownerId: string, costId: string) {
    const itinerary = await this.itineraries.findOneByTransportCost(
      ownerId,
      costId,
    );
    const cost = requireTransportCost(itinerary, costId);

    (itinerary.transportCosts as unknown as TransportCost[]).splice(
      itinerary.transportCosts.indexOf(cost as TransportCost),
      1,
    );

    await itinerary.save();

    return { removedTransportCostId: costId };
  }

  private assertFields(
    itinerary: { days: { cityId: string }[] },
    fields: LegFields,
  ): void {
    if (fields.mode === undefined || fields.mode.trim() === '') {
      throw new BadRequestException('A transport cost needs a mode');
    }

    if (fields.fromCityId === fields.toCityId) {
      throw new BadRequestException(
        'A transport cost needs two different cities',
      );
    }

    const cityIds = new Set(itinerary.days.map((day) => day.cityId));

    if (!cityIds.has(fields.fromCityId) || !cityIds.has(fields.toCityId)) {
      throw new BadRequestException(
        'Both cities of a transport cost must be used by the itinerary days',
      );
    }

    if (fields.amount !== undefined && !isMoney(fields.amount)) {
      throw new BadRequestException(
        'amount must be a non-negative amount with at most 2 decimals',
      );
    }

    if (
      fields.date !== undefined &&
      fields.date !== '' &&
      !isCalendarDate(fields.date)
    ) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    }
  }
}
