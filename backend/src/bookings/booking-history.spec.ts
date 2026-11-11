import { jest } from '@jest/globals';
import { Types } from 'mongoose';
import { BookingsService } from './bookings.service';
import { BookingStatus } from './schemas/booking.schema';

describe('owner booking history', () => {
  it('groups a round trip by its return departure and separates cancelled bookings', async () => {
    const outbound = new Types.ObjectId();
    const inbound = new Types.ObjectId();
    const now = new Date('2026-11-11T12:00:00Z');
    const bookings = [
      {
        flightId: outbound,
        returnFlightId: inbound,
        status: BookingStatus.CONFIRMED,
      },
      { flightId: outbound, status: BookingStatus.CANCELLED },
    ];
    const bookingFind = jest
      .fn()
      .mockReturnValue({ sort: () => ({ exec: async () => bookings }) });
    const flightFind = jest.fn().mockReturnValue({
      exec: async () => [
        { _id: outbound, departureTimeUtc: new Date('2026-11-10T12:00:00Z') },
        { _id: inbound, departureTimeUtc: new Date('2026-11-12T12:00:00Z') },
      ],
    });
    const service = new BookingsService(
      { find: bookingFind } as never,
      { find: flightFind } as never,
      {} as never,
    );
    const history = await service.historyForUser('owner-1', now);
    expect(history.upcoming).toEqual([bookings[0]]);
    expect(history.cancelled).toEqual([bookings[1]]);
    expect(history.past).toEqual([]);
    expect(bookingFind).toHaveBeenCalledWith({ userId: 'owner-1' });
  });
});
