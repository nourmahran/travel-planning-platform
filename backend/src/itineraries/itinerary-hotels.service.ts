import { Inject, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';

import { ItinerariesService } from './itineraries.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { cityGroupsOf } from './itinerary-groups';
import type { CityGroup } from './city-groups';
import { addDays } from './days-and-dates';
import {
  HOTEL_SEARCH_PORT,
  type HotelOption,
  type HotelSearchPort,
} from './hotel-search.port';

export type HotelStay = {
  cityId: string;
  cityName: string;
  countryCode: string;
  fromDay: number;
  toDay: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  rooms: number;
  available: boolean;
  reason?: string;
  hotels: HotelOption[];
};

export type ItineraryHotels = {
  itineraryId: string;
  guests: number;
  rooms: number;
  available: boolean;
  reason?: string;
  groups: HotelStay[];
};

@Injectable()
export class ItineraryHotelsService {
  private readonly logger = new Logger(ItineraryHotelsService.name);

  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly referenceData: ReferenceDataService,
    @Inject(HOTEL_SEARCH_PORT)
    private readonly hotelSearch: HotelSearchPort,
  ) {}

  /**
   * ITN-25: one stay per city group, checking out the morning after the last
   * day in that city. Never invents a hotel: an absent provider or an empty
   * result is reported as unavailable with a reason.
   */
  async forItinerary(
    ownerId: string,
    itineraryId: string,
    options: { guests?: number; rooms?: number } = {},
  ): Promise<ItineraryHotels> {
    const guests = options.guests ?? 1;
    const rooms = options.rooms ?? 1;
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);
    const groups = await cityGroupsOf(itinerary, this.referenceData);

    if (groups.length === 0) {
      return {
        itineraryId: String(itinerary._id),
        guests,
        rooms,
        available: false,
        reason: 'The itinerary has no days to stay overnight',
        groups: [],
      };
    }

    const stays: HotelStay[] = [];

    for (const group of groups) {
      stays.push(await this.stayFor(group, guests, rooms));
    }

    const available = stays.some((stay) => stay.available);

    return {
      itineraryId: String(itinerary._id),
      guests,
      rooms,
      available,
      reason: available ? undefined : stays[0].reason,
      groups: stays,
    };
  }

  private async stayFor(
    group: CityGroup,
    guests: number,
    rooms: number,
  ): Promise<HotelStay> {
    const checkIn = group.dateFrom;
    const checkOut = addDays(group.dateTo, 1);
    const base = {
      cityId: group.cityId,
      cityName: group.cityName,
      countryCode: group.countryCode,
      fromDay: group.fromDay,
      toDay: group.toDay,
      checkIn,
      checkOut,
      nights: nightsBetween(checkIn, checkOut),
      guests,
      rooms,
    };

    try {
      const result = await this.hotelSearch.search({
        cityId: group.cityId,
        cityName: group.cityName,
        checkIn,
        checkOut,
        guests,
        rooms,
      });
      const hotels = result.hotels ?? [];

      return {
        ...base,
        available: hotels.length > 0,
        reason: hotels.length > 0 ? undefined : result.reason ?? 'No hotels found for these dates',
        hotels,
      };
    } catch (error) {
      this.logger.warn(
        `Hotel search failed for ${group.cityId}: ${String(error)}`,
      );

      return {
        ...base,
        available: false,
        reason: 'Hotel search is unavailable right now',
        hotels: [],
      };
    }
  }
}

/** Whole nights between two YYYY-MM-DD dates. */
function nightsBetween(checkIn: string, checkOut: string): number {
  const from = DateTime.fromISO(checkIn, { zone: 'utc' });
  const to = DateTime.fromISO(checkOut, { zone: 'utc' });

  return Math.round(to.diff(from, 'days').days);
}
