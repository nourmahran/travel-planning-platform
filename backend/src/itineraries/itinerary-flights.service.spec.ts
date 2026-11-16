import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { ItineraryFlightsService } from './itinerary-flights.service';
import { ItinerariesService } from './itineraries.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { FlightsService } from '../flights/flights.service';

const OWNER = 'a'.repeat(24);
const ITINERARY_ID = 'c'.repeat(24);

const makeItinerary = () => ({
  _id: ITINERARY_ID,
  ownerId: OWNER,
  countries: ['EG'],
  startDate: '2026-11-20',
  days: [
    { _id: '1'.repeat(24), dayNumber: 1, date: '2026-11-20', cityId: 'cairo' },
    { _id: '2'.repeat(24), dayNumber: 2, date: '2026-11-21', cityId: 'cairo' },
    { _id: '3'.repeat(24), dayNumber: 3, date: '2026-11-22', cityId: 'luxor' },
  ],
});

const flight = (
  id: string,
  price: number,
  departureAirport = 'CAI',
  arrivalAirport = 'LXR',
) => ({
  _id: id,
  flightNumber: 'MS100',
  airlineId: 'airline',
  departureAirport,
  arrivalAirport,
  departureTimeUtc: new Date('2026-11-22T08:00:00.000Z'),
  arrivalTimeUtc: new Date('2026-11-22T09:00:00.000Z'),
  departureTimeZone: 'Africa/Cairo',
  arrivalTimeZone: 'Africa/Cairo',
  cabins: [
    {
      cabinClass: 'Economy',
      price,
      totalSeats: 100,
      availableSeats: 20,
      baggageAllowanceKg: 23,
      extraBaggagePricePerKg: 5,
    },
    {
      cabinClass: 'Business',
      price: price * 3,
      totalSeats: 10,
      availableSeats: 4,
      baggageAllowanceKg: 40,
      extraBaggagePricePerKg: 5,
    },
  ],
});

const page = (flights: unknown[]) => ({
  flights,
  total: flights.length,
  page: 1,
  limit: 10,
  totalPages: 1,
});

describe('ItineraryFlightsService', () => {
  let service: ItineraryFlightsService;
  let itineraries: { findOne: jest.Mock };
  let referenceData: {
    citiesInCountries: jest.Mock;
    airportsInCity: jest.Mock;
    airport: jest.Mock;
    city: jest.Mock;
  };
  let flights: { searchFlights: jest.Mock };

  beforeEach(async () => {
    itineraries = { findOne: jest.fn().mockResolvedValue(makeItinerary()) };
    referenceData = {
      citiesInCountries: jest.fn().mockResolvedValue([
        { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
        { city_id: 'luxor', name: 'Luxor', country_code: 'EG' },
      ]),
      airportsInCity: jest.fn().mockImplementation((cityId: string) =>
        Promise.resolve(
          cityId === 'cairo'
            ? [
                {
                  iata_code: 'CAI',
                  name: 'Cairo International',
                  city_id: 'cairo',
                  country_code: 'EG',
                  time_zone: 'Africa/Cairo',
                },
              ]
            : [
                {
                  iata_code: 'LXR',
                  name: 'Luxor International',
                  city_id: 'luxor',
                  country_code: 'EG',
                  time_zone: 'Africa/Cairo',
                },
              ],
        ),
      ),
      airport: jest.fn().mockImplementation((code: string) =>
        Promise.resolve(
          code === 'CAI' || code === 'LXR' || code === 'HRG'
            ? {
                iata_code: code,
                name: code,
                city_id: code === 'LXR' ? 'luxor' : 'cairo',
                country_code: 'EG',
                time_zone: 'Africa/Cairo',
              }
            : null,
        ),
      ),
      city: jest.fn().mockImplementation((cityId: string) =>
        Promise.resolve({
          city_id: cityId,
          name: cityId === 'cairo' ? 'Cairo' : 'Luxor',
          country_code: 'EG',
        }),
      ),
    };
    flights = {
      searchFlights: jest.fn().mockResolvedValue(page([flight('f1', 120)])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItineraryFlightsService,
        { provide: ItinerariesService, useValue: itineraries },
        { provide: ReferenceDataService, useValue: referenceData },
        { provide: FlightsService, useValue: flights },
      ],
    }).compile();

    service = module.get(ItineraryFlightsService);
  });

  it('checks ownership through the itinerary service', async () => {
    await service.forItinerary(OWNER, ITINERARY_ID);

    expect(itineraries.findOne).toHaveBeenCalledWith(OWNER, ITINERARY_ID);
  });

  it('propagates the ownership error', async () => {
    itineraries.findOne.mockRejectedValue(
      new ForbiddenException('You do not own this itinerary'),
    );

    await expect(
      service.forItinerary('b'.repeat(24), ITINERARY_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('builds one leg per change of city, dated on the arrival day', async () => {
    const result = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(result.legs).toHaveLength(1);
    expect(result.legs[0]).toMatchObject({
      fromCity: { id: 'cairo', name: 'Cairo' },
      toCity: { id: 'luxor', name: 'Luxor' },
      date: '2026-11-22',
      available: true,
    });
    expect(flights.searchFlights).toHaveBeenCalledWith({
      departureAirport: 'CAI',
      arrivalAirport: 'LXR',
      departureDate: '2026-11-22',
      passengers: 1,
      limit: 10,
    });
  });

  it('returns the cheapest cabin per flight and sorts options by price', async () => {
    flights.searchFlights.mockResolvedValue(
      page([flight('f1', 300), flight('f2', 120), flight('f3', 200)]),
    );

    const { legs } = await service.forItinerary(OWNER, ITINERARY_ID, {
      passengers: 2,
    });

    expect(legs[0].options.map((option) => option.flightId)).toEqual([
      'f2',
      'f3',
      'f1',
    ]);
    expect(legs[0].options[0]).toMatchObject({
      cabinClass: 'Economy',
      price: 120,
      totalPrice: 240,
      availableSeats: 20,
    });
  });

  it('keeps only the requested number of options', async () => {
    flights.searchFlights.mockResolvedValue(
      page([
        flight('f1', 300),
        flight('f2', 120),
        flight('f3', 200),
        flight('f4', 150),
      ]),
    );

    const { legs } = await service.forItinerary(OWNER, ITINERARY_ID, {
      limit: 2,
    });

    expect(legs[0].options).toHaveLength(2);
    expect(legs[0].options.map((option) => option.flightId)).toEqual([
      'f2',
      'f4',
    ]);
  });

  it('reports a city without an airport instead of guessing one', async () => {
    referenceData.airportsInCity.mockImplementation((cityId: string) =>
      Promise.resolve(cityId === 'cairo' ? [] : [
        {
          iata_code: 'LXR',
          name: 'Luxor International',
          city_id: 'luxor',
          country_code: 'EG',
          time_zone: 'Africa/Cairo',
        },
      ]),
    );

    const result = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(result.available).toBe(false);
    expect(result.legs[0]).toMatchObject({ available: false, options: [] });
    expect(result.legs[0].reason).toMatch(/Cairo/);
    expect(flights.searchFlights).not.toHaveBeenCalled();
  });

  it('reports a leg with no matching flight', async () => {
    flights.searchFlights.mockResolvedValue(page([]));

    const result = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(result.available).toBe(false);
    expect(result.legs[0]).toMatchObject({ available: false, options: [] });
    expect(result.legs[0].reason).toMatch(/no flight/i);
  });

  it('searches every airport pair of two multi-airport cities without duplicates', async () => {
    referenceData.airportsInCity.mockImplementation((cityId: string) =>
      Promise.resolve(
        cityId === 'cairo'
          ? ['CAI', 'SPX'].map((code) => ({
              iata_code: code,
              name: code,
              city_id: 'cairo',
              country_code: 'EG',
              time_zone: 'Africa/Cairo',
            }))
          : ['LXR', 'ASW'].map((code) => ({
              iata_code: code,
              name: code,
              city_id: 'luxor',
              country_code: 'EG',
              time_zone: 'Africa/Cairo',
            })),
      ),
    );
    flights.searchFlights
      .mockResolvedValueOnce(page([flight('f1', 100, 'CAI', 'LXR')]))
      .mockResolvedValueOnce(page([flight('f2', 90, 'CAI', 'ASW')]))
      .mockResolvedValueOnce(page([flight('f1', 100, 'CAI', 'LXR')]))
      .mockResolvedValueOnce(page([flight('f3', 110, 'SPX', 'ASW')]));

    const { legs } = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(flights.searchFlights).toHaveBeenCalledTimes(4);
    expect(legs[0].options.map((option) => option.flightId)).toEqual([
      'f2',
      'f1',
      'f3',
    ]);
  });

  it('returns no legs for a single-city itinerary', async () => {
    itineraries.findOne.mockResolvedValue({
      ...makeItinerary(),
      days: [
        { _id: '1'.repeat(24), dayNumber: 1, date: '2026-11-20', cityId: 'cairo' },
      ],
    });

    const result = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(result.legs).toEqual([]);
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/one city/i);
    expect(flights.searchFlights).not.toHaveBeenCalled();
  });

  it('does not fail the itinerary when the flight search throws', async () => {
    flights.searchFlights.mockRejectedValue(new Error('bad departure date'));

    const result = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(result.available).toBe(false);
    expect(result.legs[0]).toMatchObject({ available: false, options: [] });
    expect(result.legs[0].reason).toMatch(/unavailable/i);
  });

  describe('from a chosen origin airport (ITN-26)', () => {
    const originOf = (
      result: Awaited<ReturnType<typeof service.forItinerary>>,
    ) => {
      if (result.mode !== 'origin') {
        throw new Error('expected an origin search');
      }

      return result;
    };

    it('searches one-way from the origin to the first day city on the start date', async () => {
      flights.searchFlights.mockResolvedValue(
        page([flight('f1', 120, 'HRG', 'CAI')]),
      );

      const result = originOf(
        await service.forItinerary(OWNER, ITINERARY_ID, {
          originAirport: 'hrg',
          tripType: 'one-way',
        }),
      );

      expect(result).toMatchObject({
        mode: 'origin',
        originAirport: 'HRG',
        tripType: 'one-way',
        departureDate: '2026-11-20',
        returnDate: null,
        destination: { id: 'cairo', name: 'Cairo', airports: ['CAI'] },
        available: true,
      });
      expect(flights.searchFlights).toHaveBeenCalledWith({
        departureAirport: 'HRG',
        arrivalAirport: 'CAI',
        departureDate: '2026-11-20',
        passengers: 1,
        limit: 10,
      });
      expect(result.outbound.map((option) => option.flightId)).toEqual(['f1']);
      expect(result.inbound).toEqual([]);
    });

    it('round-trips by default with the return on the last day', async () => {
      flights.searchFlights.mockResolvedValue({
        outbound: page([flight('f1', 120, 'HRG', 'CAI')]),
        inbound: page([flight('f2', 110, 'CAI', 'HRG')]),
      });

      const result = originOf(
        await service.forItinerary(OWNER, ITINERARY_ID, {
          originAirport: 'HRG',
        }),
      );

      expect(result).toMatchObject({
        tripType: 'round-trip',
        departureDate: '2026-11-20',
        returnDate: '2026-11-22',
        available: true,
      });
      expect(flights.searchFlights).toHaveBeenCalledWith({
        departureAirport: 'HRG',
        arrivalAirport: 'CAI',
        departureDate: '2026-11-20',
        returnDate: '2026-11-22',
        passengers: 1,
        limit: 10,
      });
      expect(result.outbound.map((option) => option.flightId)).toEqual(['f1']);
      expect(result.inbound.map((option) => option.flightId)).toEqual(['f2']);
    });

    it('honours an explicit return date', async () => {
      flights.searchFlights.mockResolvedValue({
        outbound: page([flight('f1', 120, 'HRG', 'CAI')]),
        inbound: page([flight('f2', 110, 'CAI', 'HRG')]),
      });

      const result = originOf(
        await service.forItinerary(OWNER, ITINERARY_ID, {
          originAirport: 'HRG',
          returnDate: '2026-11-25',
        }),
      );

      expect(result.returnDate).toBe('2026-11-25');
      expect(flights.searchFlights).toHaveBeenCalledWith(
        expect.objectContaining({ returnDate: '2026-11-25' }),
      );
    });

    it('searches every airport of the first day city and keeps the cheapest', async () => {
      referenceData.airportsInCity.mockResolvedValue([
        {
          iata_code: 'CAI',
          name: 'Cairo International',
          city_id: 'cairo',
          country_code: 'EG',
          time_zone: 'Africa/Cairo',
        },
        {
          iata_code: 'SPX',
          name: 'Sphinx',
          city_id: 'cairo',
          country_code: 'EG',
          time_zone: 'Africa/Cairo',
        },
      ]);

      flights.searchFlights
        .mockResolvedValueOnce({
          outbound: page([flight('f1', 300, 'HRG', 'CAI')]),
          inbound: page([flight('f2', 300, 'CAI', 'HRG')]),
        })
        .mockResolvedValueOnce({
          outbound: page([flight('f3', 150, 'HRG', 'SPX')]),
          inbound: page([flight('f4', 140, 'SPX', 'HRG')]),
        });

      const result = originOf(
        await service.forItinerary(OWNER, ITINERARY_ID, {
          originAirport: 'HRG',
        }),
      );

      expect(flights.searchFlights).toHaveBeenCalledTimes(2);
      expect(result.outbound.map((option) => option.flightId)).toEqual([
        'f3',
        'f1',
      ]);
      expect(result.inbound.map((option) => option.flightId)).toEqual([
        'f4',
        'f2',
      ]);
    });

    it('rejects an airport that is not in the reference list', async () => {
      await expect(
        service.forItinerary(OWNER, ITINERARY_ID, { originAirport: 'ZZZ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(flights.searchFlights).not.toHaveBeenCalled();
    });

    it('rejects a return date before the start date', async () => {
      await expect(
        service.forItinerary(OWNER, ITINERARY_ID, {
          originAirport: 'HRG',
          returnDate: '2026-11-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reports a first day city with no airport instead of guessing one', async () => {
      referenceData.airportsInCity.mockResolvedValue([]);

      const result = originOf(
        await service.forItinerary(OWNER, ITINERARY_ID, {
          originAirport: 'HRG',
        }),
      );

      expect(result).toMatchObject({
        available: false,
        destination: { id: 'cairo', name: 'Cairo', airports: [] },
        outbound: [],
        inbound: [],
      });
      expect(result.reason).toMatch(/No airport/);
      expect(flights.searchFlights).not.toHaveBeenCalled();
    });

    it('says so when the only airport of the city is the origin', async () => {
      referenceData.airportsInCity.mockResolvedValue([
        {
          iata_code: 'CAI',
          name: 'Cairo International',
          city_id: 'cairo',
          country_code: 'EG',
          time_zone: 'Africa/Cairo',
        },
      ]);

      const result = originOf(
        await service.forItinerary(OWNER, ITINERARY_ID, {
          originAirport: 'CAI',
        }),
      );

      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/no airport other than CAI/i);
      expect(flights.searchFlights).not.toHaveBeenCalled();
    });

    it('reports a search that fails for every airport', async () => {
      flights.searchFlights.mockRejectedValue(new Error('boom'));

      const result = originOf(
        await service.forItinerary(OWNER, ITINERARY_ID, {
          originAirport: 'HRG',
        }),
      );

      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/unavailable/i);
    });
  });
});
