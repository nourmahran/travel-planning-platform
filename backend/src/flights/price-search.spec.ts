import { jest } from '@jest/globals';
import { ValidationPipe } from '@nestjs/common';
import { FlightsService } from './flights.service';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { CabinClass } from './schemas/flight.schema';
describe('Price search', () => {
  it('sorts by actual flight duration before pagination', async () => {
    const aggregate = jest
      .fn()
      .mockReturnValue({ exec: async () => [{ flights: [], count: [] }] });
    const service = new FlightsService(
      { aggregate } as never,
      {
        find: () => ({
          select: () => ({ exec: async () => [{ _id: 'airline' }] }),
        }),
      } as never,
      {
        db: {
          collection: () => ({ findOne: async () => ({ time_zone: 'UTC' }) }),
        },
      } as never,
    );
    await service.searchFlights({
      departureAirport: 'CAI',
      arrivalAirport: 'DXB',
      sortBy: 'duration_asc',
      page: 2,
      limit: 5,
    });
    const pipeline = aggregate.mock.calls[0][0] as unknown[];
    expect(JSON.stringify(pipeline)).toContain('"durationMinutes":1');
    expect(JSON.stringify(pipeline)).toContain('"$skip":5');
  });
  it('validates HTTP price bounds', async () => {
    const pipe = new ValidationPipe({ transform: true });
    const transform = (value: object) =>
      pipe.transform(value, { type: 'query', metatype: SearchFlightsDto });
    await expect(transform({ minPrice: '-1' })).rejects.toThrow();
    await expect(transform({ maxPrice: 'Infinity' })).rejects.toThrow();
    await expect(transform({ sortBy: 'wrong' })).rejects.toThrow();
    await expect(transform({ minPrice: '100.50' })).resolves.toMatchObject({
      minPrice: 100.5,
    });
  });
  it('rejects inverted price bounds before querying the database', async () => {
    const service = new FlightsService({} as never, {} as never, {} as never);
    await expect(
      service.searchFlights({ minPrice: 200, maxPrice: 100 }),
    ).rejects.toThrow('Invalid price');
  });
  it('filters and sorts eligible cabins before pagination on both legs', async () => {
    const aggregate = jest.fn().mockReturnValue({
      exec: async () => [{ flights: [], count: [{ total: 11 }] }],
    });
    const connection = {
      db: {
        collection: () => ({ findOne: async () => ({ time_zone: 'UTC' }) }),
      },
    };
    const service = new FlightsService(
      { aggregate } as never,
      {
        find: () => ({
          select: () => ({ exec: async () => [{ _id: 'airline' }] }),
        }),
      } as never,
      connection as never,
    );
    const result = await service.searchFlights({
      departureAirport: 'CAI',
      arrivalAirport: 'DXB',
      departureDate: '2030-12-01',
      returnDate: '2030-12-08',
      minPrice: 100,
      maxPrice: 500,
      cabinClass: CabinClass.ECONOMY,
      passengers: 2,
      sortBy: 'price_desc',
      page: 2,
      limit: 5,
    });
    expect(result).toMatchObject({
      outbound: { total: 11, totalPages: 3 },
      inbound: { total: 11 },
    });
    expect(aggregate).toHaveBeenCalledTimes(2);
    for (const [pipeline] of aggregate.mock.calls) {
      expect(pipeline).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            $match: expect.objectContaining({
              cabins: {
                $elemMatch: {
                  cabinClass: CabinClass.ECONOMY,
                  availableSeats: { $gte: 2 },
                  price: { $gte: 100, $lte: 500 },
                },
              },
            }),
          }),
        ]),
      );
      expect(JSON.stringify(pipeline)).toContain('"matchingPrice":-1');
      expect(JSON.stringify(pipeline)).toContain('$$c.availableSeats');
    }
  });
});
