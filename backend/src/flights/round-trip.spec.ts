import { jest as esmJest } from '@jest/globals';
const jest = esmJest as unknown as typeof globalThis.jest;
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Connection, Model } from 'mongoose';
import { FlightsService } from './flights.service';
import { FlightDocument, CabinClass } from './schemas/flight.schema';
import { AirlineDocument } from '../airlines/schemas/airline.schema';
import { SearchFlightsDto } from './dto/search-flights.dto';

describe('Flight search regression tests', () => {
  const zones: Record<string, string> = { CAI: 'Africa/Cairo', DXB: 'Asia/Dubai', JFK: 'America/New_York' };
  let service: FlightsService;
  let find: jest.Mock;
  let skip: jest.Mock;
  let limit: jest.Mock;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    skip = jest.fn().mockReturnThis();
    limit = jest.fn().mockReturnThis();
    find = jest.fn(() => ({ sort: jest.fn().mockReturnThis(), skip, limit, exec: jest.fn().mockResolvedValue([]) }));
    const model = { find, countDocuments: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(0) })) };
    const connection = { db: { collection: () => ({ findOne: async ({ iata_code }: { iata_code: string }) => zones[iata_code] ? { time_zone: zones[iata_code] } : null }) } };
    service = new FlightsService(model as unknown as Model<FlightDocument>, {} as Model<AirlineDocument>, connection as unknown as Connection);
  });
  afterEach(() => jest.useRealTimers());
  const query = { departureAirport: 'CAI', arrivalAirport: 'DXB', departureDate: '2026-12-01', returnDate: '2026-12-08', cabinClass: CabinClass.ECONOMY, passengers: 2 };

  it('preserves the one-way response', async () => {
    const { returnDate, ...oneWay } = query;
    expect(await service.searchFlights(oneWay)).toEqual({ flights: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    expect(find).toHaveBeenCalledTimes(1);
  });
  it('reverses airports and uses each departure airport local midnight', async () => {
    const result = await service.searchFlights({ ...query, page: 2, limit: 5, returnPage: 3, returnLimit: 7 });
    expect(result).toMatchObject({ outbound: { page: 2, limit: 5 }, inbound: { page: 3, limit: 7 } });
    const filters = find.mock.calls.map(call => call[0]);
    expect(filters[0]).toMatchObject({ departureAirport: 'CAI', arrivalAirport: 'DXB', departureTimeUtc: { $gte: new Date('2026-11-30T22:00:00Z'), $lt: new Date('2026-12-01T22:00:00Z') } });
    expect(filters[1]).toMatchObject({ departureAirport: 'DXB', arrivalAirport: 'CAI', departureTimeUtc: { $gte: new Date('2026-12-07T20:00:00Z'), $lt: new Date('2026-12-08T20:00:00Z') } });
    for (const filter of filters) expect(filter.cabins).toEqual({ $elemMatch: { cabinClass: CabinClass.ECONOMY, availableSeats: { $gte: 2 } } });
    expect(skip.mock.calls).toEqual([[5], [14]]);
  });
  it.each([['2026-03-08', 23], ['2026-11-01', 25]])('handles DST on %s', async (date, hours) => {
    await service.searchFlights({ departureAirport: 'JFK', departureDate: date as string });
    const range = find.mock.calls[0][0].departureTimeUtc;
    expect((range.$lt.getTime() - range.$gte.getTime()) / 3600000).toBe(hours);
  });
  it.each([
    { returnDate: '2026-11-30' }, { returnDate: '2026-02-30' },
    { arrivalAirport: undefined }, { departureDate: undefined },
    { arrivalAirport: 'CAI' }, { returnPage: 0 }, { returnLimit: 101 },
    { passengers: 0 }, { departureDate: '2026-13-01' },
  ])('rejects invalid round-trip input %j', async (changes) => {
    await expect(service.searchFlights({ ...query, ...changes })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('accepts same-day return searches', async () => {
    await expect(service.searchFlights({ ...query, returnDate: query.departureDate })).resolves.toHaveProperty('inbound');
  });
  it('transforms HTTP query numbers and retains return fields', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const dto = await pipe.transform({ ...query, passengers: '2', returnPage: '3', returnLimit: '7' }, { type: 'query', metatype: SearchFlightsDto });
    expect(dto).toMatchObject({ passengers: 2, returnPage: 3, returnLimit: 7, returnDate: query.returnDate });
  });
});
