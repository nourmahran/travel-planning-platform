import { jest } from '@jest/globals';
import { BookingsService } from './bookings.service';
import { CabinClass, FlightStatus } from '../flights/schemas/flight.schema';

const outboundId = '507f1f77bcf86cd799439011';
const returnId = '507f1f77bcf86cd799439012';
const cabin = (price: number, availableSeats: number) => ({
  cabinClass: CabinClass.ECONOMY,
  price,
  totalSeats: 10,
  availableSeats,
});
const outbound = {
  _id: outboundId,
  status: FlightStatus.SCHEDULED,
  departureAirport: 'CAI',
  arrivalAirport: 'DXB',
  departureTimeUtc: new Date('2030-12-01T10:00:00Z'),
  arrivalTimeUtc: new Date('2030-12-01T14:00:00Z'),
  departureTimeZone: 'Africa/Cairo',
  cabins: [cabin(2500, 10)],
};
const inbound = {
  ...outbound,
  _id: returnId,
  departureAirport: 'DXB',
  arrivalAirport: 'CAI',
  departureTimeUtc: new Date('2030-12-08T10:00:00Z'),
  arrivalTimeUtc: new Date('2030-12-08T14:00:00Z'),
  departureTimeZone: 'Asia/Dubai',
  cabins: [cabin(3000, 10)],
};
const dto = {
  flightId: outboundId,
  returnFlightId: returnId,
  userId: 'user',
  cabinClass: CabinClass.ECONOMY,
  passengers: [
    {
      firstName: 'Ali',
      lastName: 'Ahmed',
      passportNumber: 'A1234',
      dateOfBirth: '1990-01-01',
    },
  ],
};

describe('Round-trip booking', () => {
  function setup(failReturn = false) {
    const session = {
      withTransaction: jest
        .fn<(callback: () => Promise<void>) => Promise<void>>()
        .mockImplementation(async (callback) => callback()),
      endSession: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const bookings = {
      db: { startSession: async () => session },
      create: jest.fn().mockResolvedValue([{ _id: 'booking' }]),
    };
    const flights = {
      findById: jest.fn().mockImplementation((id: unknown) => ({
        exec: async () => (String(id) === outboundId ? outbound : inbound),
      })),
      findOneAndUpdate: jest
        .fn()
        .mockImplementation((filter: { _id: string }) => ({
          exec: async () =>
            filter._id.toString() === outboundId
              ? outbound
              : failReturn
                ? null
                : inbound,
        })),
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

  it('holds both segments and creates one booking with one total and reference', async () => {
    const { service, flights, bookings, session } = setup();
    await service.create(dto);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(flights.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(bookings.create).toHaveBeenCalledTimes(1);
    expect(bookings.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          returnFlightId: expect.anything(),
          totalPrice: 5500,
          seatCount: 1,
          returnSeatCount: 1,
        }),
      ],
      { session },
    );
  });

  it('aborts the transaction if the return leg loses its seat', async () => {
    const { service, bookings, session } = setup(true);
    await expect(service.create(dto)).rejects.toThrow(
      'Return seats are no longer available',
    );
    expect(bookings.create).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
