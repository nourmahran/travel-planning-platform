import { jest } from '@jest/globals';
import { Types } from 'mongoose';
import { BookingsService } from './bookings.service';
import { BookingStatus } from './schemas/booking.schema';
import { CabinClass, FlightStatus } from '../flights/schemas/flight.schema';

describe('paid booking cancellation state', () => {
  it('atomically releases booked seats, cancels the owner booking and notifies the user', async () => {
    const id = new Types.ObjectId();
    const flightId = new Types.ObjectId();
    const now = new Date();
    const booking = {
      _id: id,
      flightId,
      userId: 'owner-1',
      status: BookingStatus.CONFIRMED,
      cabinClass: CabinClass.ECONOMY,
      seatCount: 2,
      reference: 'REF-1',
    };
    const flight = {
      status: FlightStatus.SCHEDULED,
      departureTimeUtc: new Date(now.getTime() + 86_400_000),
      cabins: [
        { cabinClass: CabinClass.ECONOMY, totalSeats: 10, availableSeats: 8 },
      ],
    };
    const session = {
      withTransaction: async (fn: () => Promise<void>) => fn(),
      endSession: jest.fn(),
    };
    const query = (value: unknown) => ({
      session: () => query(value),
      exec: async () => value,
    });
    const bookingUpdate = jest
      .fn()
      .mockReturnValue(query({ ...booking, status: BookingStatus.CANCELLED }));
    const flightUpdate = jest.fn().mockReturnValue(query(flight));
    const insertOne = jest.fn(async () => ({}));
    const service = new BookingsService(
      {
        findOne: jest.fn().mockReturnValue(query(booking)),
        findOneAndUpdate: bookingUpdate,
        db: {
          startSession: async () => session,
          collection: () => ({ insertOne }),
        },
      } as never,
      {
        findById: () => query(flight),
        findOneAndUpdate: flightUpdate,
      } as never,
      {} as never,
    );

    await service.cancelConfirmedState(id.toString(), 'owner-1', now);
    expect(flightUpdate.mock.calls[0][1]).toEqual({
      $inc: { 'cabins.$.availableSeats': 2 },
    });
    expect(bookingUpdate.mock.calls[0][0]).toMatchObject({
      userId: 'owner-1',
      status: BookingStatus.CONFIRMED,
    });
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        type: 'flight_booking_cancelled',
      }),
      { session },
    );
    expect(session.endSession).toHaveBeenCalled();
  });
});
