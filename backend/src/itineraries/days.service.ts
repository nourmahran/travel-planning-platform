
import { BadRequestException, Injectable } from '@nestjs/common';

import { ITINERARY_LIMITS } from './itinerary.constants';
import { ItinerariesService } from './itineraries.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { nextDate, renumberDays } from './days-and-dates';
import { dayList, requireDay } from './subdocuments';
import type { Day } from './schemas/itinerary.schema';

@Injectable()
export class DaysService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  async add(ownerId: string, itineraryId: string, cityId: string) {
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);

    if (itinerary.days.length >= ITINERARY_LIMITS.maxDays) {
      throw new BadRequestException(
        `An itinerary can hold at most ${ITINERARY_LIMITS.maxDays} days`,
      );
    }

    await this.assertCityAllowed(cityId, itinerary.countries);

    const dayNumber = itinerary.days.length + 1;

    itinerary.days.push({
      dayNumber,
      date: nextDate(itinerary.startDate, dayNumber),
      cityId,
      activities: [],
      budgets: [],
    } as Day);

    renumberDays(itinerary.startDate, dayList(itinerary));

    await itinerary.save();

    const days = dayList(itinerary);
    const day = days[days.length - 1];

    return {
      day: { id: day._id.toString(), dayNumber: day.dayNumber, date: day.date, cityId: day.cityId },
      dayCount: days.length,
    };
  }

  async update(
    ownerId: string,
    itineraryId: string,
    dayId: string,
    changes: { cityId?: string; notes?: string },
  ) {
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);
    const day = requireDay(itinerary, dayId);

    if (changes.cityId === undefined && changes.notes === undefined) {
      throw new BadRequestException(
        'Send cityId or notes to change a day',
      );
    }

    if (changes.cityId !== undefined) {
      await this.assertCityAllowed(changes.cityId, itinerary.countries);

      day.cityId = changes.cityId;
    }

    if (changes.notes !== undefined) {
      day.notes = changes.notes.trim() || undefined;
    }

    await itinerary.save();

    return {
      id: day._id.toString(),
      dayNumber: day.dayNumber,
      date: day.date,
      cityId: day.cityId,
      notes: day.notes,
    };
  }

  async remove(ownerId: string, itineraryId: string, dayId: string) {
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);
    const days = dayList(itinerary);
    const index = days.indexOf(requireDay(itinerary, dayId));

    days.splice(index, 1);
    renumberDays(itinerary.startDate, days);

    await itinerary.save();

    return { removedDayId: dayId, dayCount: days.length };
  }

  async reorder(ownerId: string, itineraryId: string, dayIds: string[]) {
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);
    const days = dayList(itinerary);

    if (dayIds.length !== days.length) {
      throw new BadRequestException(
        'dayIds must list every day of the itinerary',
      );
    }

    if (new Set(dayIds).size !== dayIds.length) {
      throw new BadRequestException('dayIds must not contain duplicates');
    }

    const byId = new Map(days.map((day) => [day._id.toString(), day]));

    if (dayIds.some((id) => !byId.has(id))) {
      throw new BadRequestException(
        'dayIds references a day that does not belong to this itinerary',
      );
    }

    itinerary.days = dayIds.map((id) => byId.get(id)!) as Day[];

    renumberDays(itinerary.startDate, dayList(itinerary));

    await itinerary.save();

    return dayList(itinerary).map((day) => ({
      id: day._id.toString(),
      dayNumber: day.dayNumber,
      date: day.date,
      cityId: day.cityId,
    }));
  }

  private async assertCityAllowed(
    cityId: string,
    countries: string[],
  ): Promise<void> {
    const city = await this.referenceData.city(cityId);

    if (!city) {
      throw new BadRequestException(`Unknown city: ${cityId}`);
    }

    if (!countries.includes(city.country_code)) {
      throw new BadRequestException(
        `${city.name} is not in the countries selected for this itinerary`,
      );
    }
  }
}
