import { jest } from '@jest/globals';
import { Types } from 'mongoose';
import { ProviderFlightCancellationService } from './provider-flight-cancellation.service';
import { BookingStatus } from '../bookings/schemas/booking.schema';
import { FlightStatus, CabinClass } from './schemas/flight.schema';
import { BookingType } from '../common/booking';
import { RefundReason } from '../payments/schemas/refund.schema';

describe('airline flight cancellation', () => {
  it('cancels a scheduled flight and confirmed booking, then requests a full refund', async () => {
    const id = new Types.ObjectId();
    const airlineId = new Types.ObjectId();
    const bookingId = new Types.ObjectId();
    const flight = {
      _id: id,
      airlineId,
      status: FlightStatus.SCHEDULED,
      departureTimeUtc: new Date(Date.now() + 86_400_000),
      cabins: [
        {
          cabinClass: CabinClass.ECONOMY,
          price: 100,
          totalSeats: 10,
          availableSeats: 9,
        },
      ],
    };
    const booking = {
      _id: bookingId,
      userId: 'owner-1',
      flightId: id,
      status: BookingStatus.CONFIRMED,
      cabinClass: CabinClass.ECONOMY,
      seatCount: 1,
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
    const flightUpdate = jest
      .fn()
      .mockReturnValue(query({ ...flight, status: FlightStatus.CANCELLED }));
    const insertMany = jest.fn(async () => ({}));
    const bookings = {
      find: jest.fn((filter: { status: unknown }) => {
        if (filter.status === BookingStatus.CONFIRMED) return query([booking]);
        if (filter.status === BookingStatus.CANCELLED) return query([booking]);
        return query([booking]);
      }),
      findOneAndUpdate: bookingUpdate,
      updateOne: jest.fn(async () => ({})),
    };
    const flights = {
      findById: jest
        .fn()
        .mockReturnValueOnce(query(flight))
        .mockReturnValueOnce(
          query({ ...flight, status: FlightStatus.CANCELLED }),
        ),
      findOne: () => query(flight),
      findOneAndUpdate: flightUpdate,
    };
    const refunds = {
      assertSuccessfulPayment: jest.fn(async () => {}),
      issueRefund: jest.fn(async () => ({})),
    };
    const service = new ProviderFlightCancellationService(
      flights as never,
      bookings as never,
      refunds as never,
      {
        startSession: async () => session,
        collection: () => ({ insertMany }),
      } as never,
    );
    const result = await service.cancelForAirline(
      id.toString(),
      airlineId.toString(),
    );
    expect(result.refundedBookings).toBe(1);
    expect(refunds.assertSuccessfulPayment).toHaveBeenCalledWith(
      BookingType.Flight,
      bookingId.toString(),
    );
    expect(refunds.issueRefund).toHaveBeenCalledWith(
      BookingType.Flight,
      bookingId.toString(),
      RefundReason.ProviderCancellation,
    );
    expect(bookingUpdate.mock.calls[0][1]).toMatchObject({
      $set: { status: BookingStatus.CANCELLED, providerCancelledFlightId: id },
    });
    expect(insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          userId: 'owner-1',
          type: 'flight_cancelled',
        }),
      ],
      { session },
    );
    expect(session.endSession).toHaveBeenCalled();
  });
});
