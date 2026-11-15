import { jest } from '@jest/globals';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { FlightsService } from './flights.service';
import { CabinClass, FlightStatus } from './schemas/flight.schema';

describe('schedule changes with booked seats', () => {
  it('updates flight times and writes confirmed-passenger notifications together', async () => {
    const id = new Types.ObjectId();
    const bookingId = new Types.ObjectId();
    const departure = new Date(Date.now() + 7 * 86_400_000);
    const arrival = new Date(departure.getTime() + 2 * 3_600_000);
    const flight = {
      _id: id,
      status: FlightStatus.SCHEDULED,
      departureAirport: 'AAA',
      arrivalAirport: 'BBB',
      departureTimeUtc: departure,
      arrivalTimeUtc: arrival,
      departureTimeZone: 'UTC',
      arrivalTimeZone: 'UTC',
      cabins: [
        { cabinClass: CabinClass.ECONOMY, totalSeats: 10, availableSeats: 9 },
      ],
      save: jest.fn(),
    };
    const insertMany = jest.fn(async () => ({}));
    const findOneAndUpdate = jest
      .fn()
      .mockReturnValue({ exec: async () => flight });
    const session = {
      withTransaction: async (fn: () => Promise<void>) => fn(),
      endSession: jest.fn(),
    };
    const connection = {
      db: {
        collection: () => ({
          findOne: async ({ iata_code }: { iata_code: string }) => ({
            iata_code,
            time_zone: 'UTC',
          }),
        }),
      },
      startSession: async () => session,
      collection: (name: string) =>
        name === 'bookings'
          ? {
              find: () => ({
                toArray: async () => [
                  { _id: bookingId, userId: '507f1f77bcf86cd799439012' },
                ],
              }),
            }
          : { insertMany },
    };
    const service = new FlightsService(
      {
        findById: () => ({ exec: async () => flight }),
        findOneAndUpdate,
      } as never,
      {} as never,
      connection as never,
    );
    await service.update(id.toString(), {
      departureLocalTime: DateTime.fromJSDate(departure)
        .plus({ hours: 1 })
        .toFormat("yyyy-MM-dd'T'HH:mm:ss"),
      arrivalLocalTime: DateTime.fromJSDate(arrival)
        .plus({ hours: 1 })
        .toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    });
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: 'flight.schedule_changed',
        }),
      ],
      { session },
    );
    expect(flight.save).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });
});
