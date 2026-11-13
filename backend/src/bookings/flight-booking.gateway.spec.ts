import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BookingStatus as SharedStatus, BookingType } from '../common/booking';
import type {
  FlightPolicies,
  HotelPolicies,
} from '../payments/gateway/booking-gateway.interface';
import { FlightBookingGateway } from './flight-booking.gateway';
import { BookingStatus } from './schemas/booking.schema';

const policies: FlightPolicies = {
  kind: 'flight',
  cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
  baggage: {
    freeBagsPerPassenger: 1,
    maxWeightKgPerBag: 23,
    extraBagPrice: 40,
    maxExtraBagsPerPassenger: 2,
  },
};

function setup(currency: string | undefined = 'USD') {
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    endSession: jest.fn(async () => undefined),
  };
  const bookings = {
    findForPayment: jest.fn(),
    getCurrentPolicies: jest.fn(),
    savePolicyAcceptance: jest.fn(),
    confirm: jest.fn(),
    expireHold: jest.fn(),
  };
  const registry = { register: jest.fn() };
  const config = { get: jest.fn(() => currency) };
  const connection = { startSession: jest.fn(async () => session) };
  const gateway = new FlightBookingGateway(
    bookings as never,
    registry as never,
    config as never,
    connection as never,
  );
  return { gateway, bookings, registry, session };
}

describe('FlightBookingGateway (PAY-01 / PAY-02 / GEN-11)', () => {
  it('registers itself with the payments registry on startup', () => {
    const { gateway, registry } = setup();
    gateway.onModuleInit();
    expect(gateway.type).toBe(BookingType.Flight);
    expect(registry.register).toHaveBeenCalledWith(gateway);
  });

  it('findById returns null when the booking does not exist', async () => {
    const { gateway, bookings } = setup();
    bookings.findForPayment.mockResolvedValue(null);
    await expect(gateway.findById('x')).resolves.toBeNull();
  });

  it('findById maps the flight booking to the shared PayableBooking shape', async () => {
    const { gateway, bookings } = setup('USD');
    const holdExpiresAt = new Date('2026-12-01T10:10:00Z');
    const departure = new Date('2026-12-20T08:00:00Z');
    bookings.findForPayment.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
      providerId: 'a1',
      status: BookingStatus.PENDING_PAYMENT,
      totalPrice: 250.5,
      holdExpiresAt,
      policiesAcceptedAt: undefined,
      policySnapshot: undefined,
      departureTimeUtc: departure,
      reference: undefined,
    });
    await expect(gateway.findById('b1')).resolves.toEqual({
      id: 'b1',
      type: BookingType.Flight,
      userId: 'u1',
      status: SharedStatus.PendingPayment,
      totalAmount: 250.5,
      currency: 'usd',
      holdExpiresAt,
      policiesAcceptedAt: null,
      policySnapshot: null,
      startsAt: departure,
      reference: null,
    });
  });

  it.each([
    [BookingStatus.PENDING, SharedStatus.PendingPayment],
    [BookingStatus.PENDING_PAYMENT, SharedStatus.PendingPayment],
    [BookingStatus.CONFIRMED, SharedStatus.Confirmed],
    [BookingStatus.COMPLETED, SharedStatus.Completed],
    [BookingStatus.EXPIRED, SharedStatus.Expired],
    [BookingStatus.CANCELLED, SharedStatus.Cancelled],
  ])('maps flight status %s to %s', async (flightStatus, shared) => {
    const { gateway, bookings } = setup();
    bookings.findForPayment.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
      providerId: 'a1',
      status: flightStatus,
      totalPrice: 10,
      holdExpiresAt: null,
      departureTimeUtc: new Date(),
    });
    const booking = await gateway.findById('b1');
    expect(booking?.status).toBe(shared);
  });

  it('getProviderPolicies returns the airline policies', async () => {
    const { gateway, bookings } = setup();
    bookings.getCurrentPolicies.mockResolvedValue(policies);
    await expect(gateway.getProviderPolicies('b1')).resolves.toBe(policies);
  });

  it('savePolicyAcceptance stores flight policies on the booking', async () => {
    const { gateway, bookings } = setup();
    const at = new Date();
    bookings.savePolicyAcceptance.mockResolvedValue(undefined);
    await gateway.savePolicyAcceptance('b1', policies, at);
    expect(bookings.savePolicyAcceptance).toHaveBeenCalledWith(
      'b1',
      policies,
      at,
    );
  });

  it('savePolicyAcceptance rejects hotel policies', async () => {
    const { gateway, bookings } = setup();
    const hotel: HotelPolicies = {
      kind: 'hotel',
      cancellationTiers: [],
      checkInTime: '14:00',
      checkOutTime: '12:00',
    };
    expect(() => gateway.savePolicyAcceptance('b1', hotel, new Date())).toThrow(
      BadRequestException,
    );
    expect(bookings.savePolicyAcceptance).not.toHaveBeenCalled();
  });

  it('confirm runs BookingsService.confirm inside a transaction and returns true', async () => {
    const { gateway, bookings, session } = setup();
    bookings.confirm.mockResolvedValue({});
    await expect(gateway.confirm('b1')).resolves.toBe(true);
    expect(bookings.confirm).toHaveBeenCalledWith('b1', session);
    expect(session.withTransaction).toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });

  it.each([
    ['BadRequestException', new BadRequestException('hold expired')],
    ['NotFoundException', new NotFoundException('missing')],
  ])('confirm returns false (not throw) on %s', async (_name, error) => {
    const { gateway, bookings, session } = setup();
    bookings.confirm.mockRejectedValue(error);
    await expect(gateway.confirm('b1')).resolves.toBe(false);
    expect(session.endSession).toHaveBeenCalled();
  });

  it('confirm rethrows unexpected errors', async () => {
    const { gateway, bookings, session } = setup();
    bookings.confirm.mockRejectedValue(new Error('db down'));
    await expect(gateway.confirm('b1')).rejects.toThrow('db down');
    expect(session.endSession).toHaveBeenCalled();
  });

  it('expire delegates to expireHold', async () => {
    const { gateway, bookings } = setup();
    bookings.expireHold.mockResolvedValue(true);
    await expect(gateway.expire('b1')).resolves.toBe(true);
    expect(bookings.expireHold).toHaveBeenCalledWith('b1');
  });
});
