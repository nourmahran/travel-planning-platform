import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { ItineraryHotelsService } from './itinerary-hotels.service';
import { ItinerariesService } from './itineraries.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { HOTEL_SEARCH_PORT } from './hotel-search.port';

const OWNER = 'a'.repeat(24);
const ITINERARY_ID = 'c'.repeat(24);

const makeItinerary = () => ({
  _id: ITINERARY_ID,
  ownerId: OWNER,
  countries: ['EG'],
  days: [
    { _id: '1'.repeat(24), dayNumber: 1, date: '2026-11-20', cityId: 'cairo' },
    { _id: '2'.repeat(24), dayNumber: 2, date: '2026-11-21', cityId: 'cairo' },
    { _id: '3'.repeat(24), dayNumber: 3, date: '2026-11-22', cityId: 'luxor' },
  ],
});

describe('ItineraryHotelsService', () => {
  let service: ItineraryHotelsService;
  let itineraries: { findOne: jest.Mock };
  let referenceData: { citiesInCountries: jest.Mock };
  let port: { search: jest.Mock };

  beforeEach(async () => {
    itineraries = { findOne: jest.fn().mockResolvedValue(makeItinerary()) };
    referenceData = {
      citiesInCountries: jest.fn().mockResolvedValue([
        { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
        { city_id: 'luxor', name: 'Luxor', country_code: 'EG' },
      ]),
    };
    port = {
      search: jest.fn().mockImplementation((query: { cityId: string }) =>
        Promise.resolve({
          hotels: [
            { id: `${query.cityId}-hotel`, name: 'Nile View', nightlyPrice: 80 },
          ],
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItineraryHotelsService,
        { provide: ItinerariesService, useValue: itineraries },
        { provide: ReferenceDataService, useValue: referenceData },
        { provide: HOTEL_SEARCH_PORT, useValue: port },
      ],
    }).compile();

    service = module.get(ItineraryHotelsService);
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

  it('asks for one stay per city group with check-out after the last day', async () => {
    const result = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toMatchObject({
      cityId: 'cairo',
      cityName: 'Cairo',
      checkIn: '2026-11-20',
      checkOut: '2026-11-22',
      nights: 2,
      guests: 1,
    });
    expect(result.groups[1]).toMatchObject({
      cityId: 'luxor',
      checkIn: '2026-11-22',
      checkOut: '2026-11-23',
      nights: 1,
    });
    expect(port.search).toHaveBeenNthCalledWith(1, {
      cityId: 'cairo',
      cityName: 'Cairo',
      checkIn: '2026-11-20',
      checkOut: '2026-11-22',
      guests: 1,
      rooms: 1,
    });
  });

  it('passes the requested guest count to every stay', async () => {
    const result = await service.forItinerary(OWNER, ITINERARY_ID, {
      guests: 3,
    });

    expect(result.guests).toBe(3);
    expect(port.search).toHaveBeenCalledTimes(2);
    for (const call of port.search.mock.calls) {
      expect(call[0]).toMatchObject({ guests: 3 });
    }
  });

  it('passes the requested room count to every stay', async () => {
    const result = await service.forItinerary(OWNER, ITINERARY_ID, {
      guests: 4,
      rooms: 2,
    });

    expect(result.rooms).toBe(2);
    expect(result.groups[0]).toMatchObject({ guests: 4, rooms: 2 });
    for (const call of port.search.mock.calls) {
      expect(call[0]).toMatchObject({ guests: 4, rooms: 2 });
    }
  });

  it('returns the hotels with the group and marks the response available', async () => {
    const result = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(result.available).toBe(true);
    expect(result.groups[0].available).toBe(true);
    expect(result.groups[0].hotels).toHaveLength(1);
    expect(result.groups[0].hotels[0]).toMatchObject({ name: 'Nile View' });
  });

  it('degrades honestly when the provider has no hotels', async () => {
    port.search.mockResolvedValue({ hotels: [], reason: 'No hotels match' });

    const result = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(result.available).toBe(false);
    expect(result.groups[0]).toMatchObject({
      available: false,
      hotels: [],
      reason: 'No hotels match',
    });
  });

  it('does not fail the itinerary when the provider throws', async () => {
    port.search.mockRejectedValue(new Error('provider down'));

    const result = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(result.available).toBe(false);
    expect(result.groups[0].available).toBe(false);
    expect(result.groups[0].reason).toMatch(/unavailable/i);
  });

  it('returns no groups for an itinerary without days', async () => {
    itineraries.findOne.mockResolvedValue({ ...makeItinerary(), days: [] });

    const result = await service.forItinerary(OWNER, ITINERARY_ID);

    expect(result.groups).toEqual([]);
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/no days/i);
    expect(port.search).not.toHaveBeenCalled();
  });
});
