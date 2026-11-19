import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { ItinerariesService } from './itineraries.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { FlightsService } from '../flights/flights.service';
import { cityGroupsOf } from './itinerary-groups';
import type { CityGroup } from './city-groups';
import { roundAmount } from '../common/utils/round-amount';
import { isCalendarDate } from './days-and-dates';
import type { TripType } from './itinerary.constants';
import type { ItineraryDocument } from './schemas/itinerary.schema';

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

export type ItineraryFlights = LegsFlights | OriginFlights;

export type LegsFlights = {
  itineraryId: string;
  mode: 'legs';
  passengers: number;
  available: boolean;
  reason?: string;
  legs: FlightLeg[];
};

export type OriginFlights = {
  itineraryId: string;
  mode: 'origin';
  passengers: number;
  tripType: TripType;
  originAirport: string;
  destination: {
    id: string;
    name: string;
    airports: string[];
  } | null;
  departureDate: string;
  returnDate: string | null;
  available: boolean;
  reason?: string;
  outbound: FlightOption[];
  inbound: FlightOption[];
};

export type ItineraryFlightsOptions = {
  passengers?: number;
  limit?: number;
  /** ITN-26: when present the search runs from this airport to the first day city. */
  originAirport?: string;
  tripType?: TripType;
  returnDate?: string;
};

type FlightPage = { flights?: FlightLike[] };

type RoundTripPage = { outbound?: FlightPage; inbound?: FlightPage };

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
   * ITN-26. With an origin airport: a search from it to any airport of the
   * first day city, one-way or round-trip, outbound on the start date and the
   * return on the last day unless given. Without one: the legs between the
   * itinerary cities, each flown on its arrival day. Nothing is guessed: an
   * empty result carries a reason.
   */
  async forItinerary(
    ownerId: string,
    itineraryId: string,
    options: ItineraryFlightsOptions = {},
  ): Promise<ItineraryFlights> {
    const passengers = options.passengers ?? 1;
    const limit = options.limit ?? DEFAULT_OPTIONS;
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);

    if (options.originAirport) {
      return this.fromOrigin(itinerary, {
        ...options,
        passengers,
        limit,
      });
    }

    return this.betweenCities(itinerary, passengers, limit);
  }

  private async betweenCities(
    itinerary: ItineraryDocument,
    passengers: number,
    limit: number,
  ): Promise<LegsFlights> {
    const groups = await cityGroupsOf(itinerary, this.referenceData);

    if (groups.length < 2) {
      return {
        itineraryId: String(itinerary._id),
        mode: 'legs',
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
      mode: 'legs',
      passengers,
      available,
      reason: available ? undefined : legs.find((leg) => !leg.available)?.reason,
      legs,
    };
  }

  /** ITN-26 as written: a chosen origin airport, one-way or round-trip. */
  private async fromOrigin(
    itinerary: ItineraryDocument,
    options: Required<Pick<ItineraryFlightsOptions, 'passengers' | 'limit'>> &
      ItineraryFlightsOptions,
  ): Promise<OriginFlights> {
    const originAirport = options.originAirport!.trim().toUpperCase();
    const tripType = options.tripType ?? 'round-trip';
    const days = [...(itinerary.days ?? [])].sort(
      (left, right) => left.dayNumber - right.dayNumber,
    );
    const departureDate = itinerary.startDate;
    const lastDate = days.length > 0 ? days[days.length - 1].date : departureDate;
    const returnDate = tripType === 'round-trip' ? options.returnDate ?? lastDate : null;

    const known = await this.referenceData.airport(originAirport);

    if (!known) {
      throw new BadRequestException(`Unknown airport: ${originAirport}`);
    }

    if (returnDate !== null) {
      if (!isCalendarDate(returnDate)) {
        throw new BadRequestException(
          'returnDate must be a valid calendar date (YYYY-MM-DD)',
        );
      }

      if (returnDate < departureDate) {
        throw new BadRequestException(
          'returnDate cannot be before the itinerary start date',
        );
      }
    }

    const base = {
      itineraryId: String(itinerary._id),
      mode: 'origin' as const,
      passengers: options.passengers,
      tripType,
      originAirport,
      departureDate,
      returnDate,
    };

    if (days.length === 0) {
      return {
        ...base,
        destination: null,
        available: false,
        reason: 'The itinerary has no days to fly to',
        outbound: [],
        inbound: [],
      };
    }

    const cityId = days[0].cityId;
    const city = await this.referenceData.city(cityId);
    const cityName = city?.name ?? cityId;
    const cityAirports = (await this.referenceData.airportsInCity(cityId)).map(
      (airport) => airport.iata_code,
    );
    const airports = cityAirports
      .filter((code) => code !== originAirport)
      .slice(0, MAX_AIRPORTS_PER_CITY);

    if (airports.length === 0) {
      return {
        ...base,
        destination: { id: cityId, name: cityName, airports: [] },
        available: false,
        reason:
          cityAirports.length === 0
            ? `No airport is recorded for ${cityName}`
            : `${cityName} has no airport other than ${originAirport}`,
        outbound: [],
        inbound: [],
      };
    }

    const outboundFound = new Map<string, FlightOption>();
    const inboundFound = new Map<string, FlightOption>();
    let failed = 0;

    for (const arrivalAirport of airports) {
      try {
        const response =
          returnDate === null
            ? await this.flights.searchFlights({
                departureAirport: originAirport,
                arrivalAirport,
                departureDate,
                passengers: options.passengers,
                limit: SEARCH_PAGE_SIZE,
              })
            : await this.flights.searchFlights({
                departureAirport: originAirport,
                arrivalAirport,
                departureDate,
                returnDate,
                passengers: options.passengers,
                limit: SEARCH_PAGE_SIZE,
              });
        const outbound = returnDate === null
          ? (response as FlightPage)
          : (response as RoundTripPage).outbound;
        const inbound = returnDate === null
          ? undefined
          : (response as RoundTripPage).inbound;

        this.collect(outbound, outboundFound, options.passengers);
        this.collect(inbound, inboundFound, options.passengers);
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Flight search failed for ${originAirport}->${arrivalAirport} on ${departureDate}: ${String(error)}`,
        );
      }
    }

    const cheapest = (found: Map<string, FlightOption>) =>
      [...found.values()]
        .sort((left, right) => left.price - right.price)
        .slice(0, options.limit);
    const outbound = cheapest(outboundFound);
    const inbound = returnDate === null ? [] : cheapest(inboundFound);
    const available =
      outbound.length > 0 && (returnDate === null || inbound.length > 0);

    return {
      ...base,
      destination: { id: cityId, name: cityName, airports },
      available,
      reason: available
        ? undefined
        : failed === airports.length
          ? 'Flight search is unavailable right now'
          : outbound.length === 0
            ? 'No flight matches this trip'
            : 'No return flight matches the return date',
      outbound,
      inbound,
    };
  }

  /** Adds the cheapest cabin of each flight to the map, keeping the lowest price. */
  private collect(
    page: FlightPage | undefined,
    found: Map<string, FlightOption>,
    passengers: number,
  ): void {
    for (const flight of page?.flights ?? []) {
      const option = toFlightOption(flight, passengers);

      if (!option) {
        continue;
      }

      const existing = found.get(option.flightId);

      if (!existing || option.price < existing.price) {
        found.set(option.flightId, option);
      }
    }
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
