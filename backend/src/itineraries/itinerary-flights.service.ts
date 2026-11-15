import { Injectable, Logger } from '@nestjs/common';

import { ItinerariesService } from './itineraries.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { FlightsService } from '../flights/flights.service';
import { cityGroupsOf } from './itinerary-groups';
import type { CityGroup } from './city-groups';
import { roundAmount } from '../common/utils/round-amount';

/** Airports per city are capped so one leg cannot fan out without limit. */
const MAX_AIRPORTS_PER_CITY = 3;
const SEARCH_PAGE_SIZE = 10;
const DEFAULT_OPTIONS = 3;

export type FlightOption = {
  flightId: string;
  flightNumber: string;
  airlineId: string;
  departureAirport: string;
  arrivalAirport: string;
  departureTimeUtc: Date;
  arrivalTimeUtc: Date;
  departureTimeZone: string;
  arrivalTimeZone: string;
  cabinClass: string;
  /** Price per passenger. */
  price: number;
  /** Price for every passenger on this leg. */
  totalPrice: number;
  availableSeats: number;
  baggageAllowanceKg?: number;
};

export type FlightLeg = {
  fromCity: { id: string; name: string };
  toCity: { id: string; name: string };
  date: string;
  available: boolean;
  reason?: string;
  departureAirports: string[];
  arrivalAirports: string[];
  options: FlightOption[];
};

export type ItineraryFlights = {
  itineraryId: string;
  passengers: number;
  available: boolean;
  reason?: string;
  legs: FlightLeg[];
};

type CabinLike = {
  cabinClass: string;
  price: number;
  availableSeats: number;
  baggageAllowanceKg?: number;
};

type FlightLike = {
  _id: unknown;
  flightNumber: string;
  airlineId: unknown;
  departureAirport: string;
  arrivalAirport: string;
  departureTimeUtc: Date;
  arrivalTimeUtc: Date;
  departureTimeZone: string;
  arrivalTimeZone: string;
  cabins?: CabinLike[];
};

@Injectable()
export class ItineraryFlightsService {
  private readonly logger = new Logger(ItineraryFlightsService.name);

  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly referenceData: ReferenceDataService,
    private readonly flights: FlightsService,
  ) {}

  /**
   * ITN-26: one leg per change of city, flown on the arrival day, with the
   * cheapest cabins only. A city without an airport, or a leg with no match,
   * is reported as unavailable with a reason instead of being guessed.
   */
  async forItinerary(
    ownerId: string,
    itineraryId: string,
    options: { passengers?: number; limit?: number } = {},
  ): Promise<ItineraryFlights> {
    const passengers = options.passengers ?? 1;
    const limit = options.limit ?? DEFAULT_OPTIONS;
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);
    const groups = await cityGroupsOf(itinerary, this.referenceData);

    if (groups.length < 2) {
      return {
        itineraryId: String(itinerary._id),
        passengers,
        available: false,
        reason:
          groups.length === 0
            ? 'The itinerary has no days to fly between'
            : 'The itinerary visits one city, so it needs no flight',
        legs: [],
      };
    }

    const legs: FlightLeg[] = [];

    for (let index = 1; index < groups.length; index += 1) {
      legs.push(
        await this.legBetween(groups[index - 1], groups[index], {
          passengers,
          limit,
        }),
      );
    }

    const available = legs.every((leg) => leg.available);

    return {
      itineraryId: String(itinerary._id),
      passengers,
      available,
      reason: available ? undefined : legs.find((leg) => !leg.available)?.reason,
      legs,
    };
  }

  private async legBetween(
    origin: CityGroup,
    destination: CityGroup,
    options: { passengers: number; limit: number },
  ): Promise<FlightLeg> {
    const [originAirports, destinationAirports] = await Promise.all([
      this.referenceData.airportsInCity(origin.cityId),
      this.referenceData.airportsInCity(destination.cityId),
    ]);
    const departureAirports = originAirports
      .slice(0, MAX_AIRPORTS_PER_CITY)
      .map((airport) => airport.iata_code);
    const arrivalAirports = destinationAirports
      .slice(0, MAX_AIRPORTS_PER_CITY)
      .map((airport) => airport.iata_code);

    const base = {
      fromCity: { id: origin.cityId, name: origin.cityName },
      toCity: { id: destination.cityId, name: destination.cityName },
      date: destination.dateFrom,
      departureAirports,
      arrivalAirports,
    };

    if (departureAirports.length === 0 || arrivalAirports.length === 0) {
      const missing = [
        departureAirports.length === 0 ? origin.cityName : null,
        arrivalAirports.length === 0 ? destination.cityName : null,
      ].filter(Boolean);

      return {
        ...base,
        available: false,
        reason: `No airport is recorded for ${missing.join(' or ')}`,
        options: [],
      };
    }

    const found = new Map<string, FlightOption>();
    let failed = 0;

    for (const departureAirport of departureAirports) {
      for (const arrivalAirport of arrivalAirports) {
        try {
          const page = (await this.flights.searchFlights({
            departureAirport,
            arrivalAirport,
            departureDate: destination.dateFrom,
            passengers: options.passengers,
            limit: SEARCH_PAGE_SIZE,
          })) as { flights?: FlightLike[] };

          for (const flight of page.flights ?? []) {
            const option = toFlightOption(flight, options.passengers);

            if (!option) {
              continue;
            }

            const existing = found.get(option.flightId);

            if (!existing || option.price < existing.price) {
              found.set(option.flightId, option);
            }
          }
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `Flight search failed for ${departureAirport}->${arrivalAirport} on ${destination.dateFrom}: ${String(error)}`,
          );
        }
      }
    }

    const cheapest = [...found.values()]
      .sort((left, right) => left.price - right.price)
      .slice(0, options.limit);

    if (cheapest.length > 0) {
      return { ...base, available: true, options: cheapest };
    }

    const pairs = departureAirports.length * arrivalAirports.length;

    return {
      ...base,
      available: false,
      reason:
        failed === pairs
          ? 'Flight search is unavailable right now'
          : 'No flight matches this leg',
      options: [],
    };
  }
}

/** The cheapest cabin that seats every passenger, or null when none does. */
function toFlightOption(
  flight: FlightLike,
  passengers: number,
): FlightOption | null {
  const cabins = (flight.cabins ?? []).filter(
    (cabin) => cabin.availableSeats >= passengers,
  );

  if (cabins.length === 0) {
    return null;
  }

  const cabin = cabins.reduce((cheapest, candidate) =>
    candidate.price < cheapest.price ? candidate : cheapest,
  );

  return {
    flightId: String(flight._id),
    flightNumber: flight.flightNumber,
    airlineId: String(flight.airlineId),
    departureAirport: flight.departureAirport,
    arrivalAirport: flight.arrivalAirport,
    departureTimeUtc: flight.departureTimeUtc,
    arrivalTimeUtc: flight.arrivalTimeUtc,
    departureTimeZone: flight.departureTimeZone,
    arrivalTimeZone: flight.arrivalTimeZone,
    cabinClass: cabin.cabinClass,
    price: cabin.price,
    totalPrice: roundAmount(cabin.price * passengers),
    availableSeats: cabin.availableSeats,
    baggageAllowanceKg: cabin.baggageAllowanceKg,
  };
}
