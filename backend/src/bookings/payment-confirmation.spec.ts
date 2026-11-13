import { jest } from '@jest/globals';
import { Types } from 'mongoose';
import { BookingsService } from './bookings.service';
import { BookingStatus } from './schemas/booking.schema';
import { FlightStatus } from '../flights/schemas/flight.schema';

describe('payment confirmation transaction', () => {
  it('confirms and creates the in-app notification in the supplied session', async () => {
    const id = new Types.ObjectId();
    const flightId = new Types.ObjectId();
    const session = {} as never;
    const booking = {
      _id: id,
      flightId,
      userId: '507f1f77bcf86cd799439012',
      reference: 'REF-1',
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date(Date.now() + 600_000),
    };
    const query = (value: unknown) => ({
      session: () => query(value),
      exec: async () => value,
    });
    const insertOne = jest.fn(async () => ({}));
    const findOneAndUpdate = jest
      .fn()
      .mockReturnValue(query({ ...booking, status: BookingStatus.CONFIRMED }));
    const service = new BookingsService(
      {
        findById: () => query(booking),
        findOneAndUpdate,
        db: { collection: () => ({ insertOne }) },
      } as never,
      {
        findById: () =>
          query({
            status: FlightStatus.SCHEDULED,
            departureTimeUtc: new Date(Date.now() + 86_400_000),
          }),
      } as never,
      {} as never,
    );

    await service.confirm(id.toString(), session);
    expect(findOneAndUpdate.mock.calls[0][2]).toMatchObject({ session });
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: `flight:booking:confirmed:${id.toString()}`,
        type: 'booking.confirmed',
      }),
      { session },
    );
  });
});
