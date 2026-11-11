import { jest } from '@jest/globals';
import { BookingsService } from './bookings.service';
import { BookingStatus } from './schemas/booking.schema';
import { FlightsService } from '../flights/flights.service';
import { FlightStatus } from '../flights/schemas/flight.schema';

describe('Scheduled inventory maintenance', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  const query = (value: unknown) => ({ exec: async () => value });
  function setup(
    booking: unknown = {
      flightId: 'flight',
      cabinClass: 'Economy',
      passengers: [{}, {}],
    },
  ) {
    const session = {
      withTransaction: async (fn: () => Promise<unknown>) => fn(),
      endSession: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const bookings = {
      db: { startSession: async () => session },
      findOneAndUpdate: jest.fn().mockReturnValue(query(booking)),
    };
    const flights = {
      findById: jest.fn().mockReturnValue({
        session: () =>
          query({
            cabins: [
              { cabinClass: 'Economy', availableSeats: 8, totalSeats: 10 },
            ],
          }),
      }),
      findOneAndUpdate: jest.fn().mockReturnValue(query({})),
    };
    return {
      session,
      bookings,
      flights,
      service: new BookingsService(
        bookings as never,
        flights as never,
        {} as never,
      ),
    };
  }
  it('claims only due unpaid holds and restores the exact seat count in the same transaction', async () => {
    const { service, bookings, flights, session } = setup();
    await expect(service.expireHold('id', now)).resolves.toBe(true);
    expect(bookings.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'id',
        status: { $in: [BookingStatus.PENDING, BookingStatus.PENDING_PAYMENT] },
        holdExpiresAt: { $lte: now },
      },
      { $set: { status: BookingStatus.EXPIRED, expiredAt: now } },
      { new: true, session },
    );
    expect(flights.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'flight',
        cabins: {
          $elemMatch: { cabinClass: 'Economy', availableSeats: { $lte: 8 } },
        },
      },
      { $inc: { 'cabins.$.availableSeats': 2 } },
      { new: true, session },
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
  it('does not release inventory if another worker, payment or cancellation already changed the hold', async () => {
    const { service, flights, session } = setup(null);
    await expect(service.expireHold('id', now)).resolves.toBe(false);
    expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
  it('throws inside the transaction when seat restoration fails so the status change rolls back', async () => {
    const { service, flights, session } = setup();
    flights.findOneAndUpdate.mockReturnValue(query(null));
    await expect(service.expireHold('id', now)).rejects.toThrow(
      'Cannot restore',
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
  it('continues processing other holds after a failed release', async () => {
    const { service, bookings } = setup();
    Object.assign(bookings, {
      find: () => ({
        select: () => ({
          cursor: async function* () {
            yield { _id: 'bad' };
            yield { _id: 'good' };
          },
        }),
      }),
    });
    const release = jest
      .spyOn(service, 'expireHold')
      .mockRejectedValueOnce(new Error('failure'))
      .mockResolvedValueOnce(true);
    await service.expireHolds(now);
    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenLastCalledWith('good', now);
  });
  it('changes only scheduled flights at or before departure', async () => {
    const updateMany = jest.fn().mockReturnValue(query({ modifiedCount: 2 }));
    const service = new FlightsService(
      { updateMany } as never,
      {} as never,
      {} as never,
    );
    await expect(service.markDepartedFlights(now)).resolves.toEqual({
      modifiedCount: 2,
    });
    expect(updateMany).toHaveBeenCalledWith(
      { status: FlightStatus.SCHEDULED, departureTimeUtc: { $lte: now } },
      { $set: { status: FlightStatus.DEPARTED } },
    );
  });
});
