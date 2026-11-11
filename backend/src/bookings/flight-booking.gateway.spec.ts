import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { FlightBookingGateway } from './flight-booking.gateway';
import { BookingStatus } from './schemas/booking.schema';

describe('FlightBookingGateway payment boundary', () => {
  const booking = {
    id: '507f1f77bcf86cd799439011',
    userId: '507f1f77bcf86cd799439012',
    status: BookingStatus.PENDING_PAYMENT,
    totalPrice: 250.5,
    holdExpiresAt: new Date('2030-01-01'),
    policiesAcceptedAt: null,
    policySnapshot: null,
    departureTimeUtc: new Date('2030-02-01'),
    reference: 'BOOKING-1',
  };
  const service = {
    findForPayment: jest.fn<() => Promise<typeof booking | null>>(),
    getCurrentPolicies: jest.fn(),
    savePolicyAcceptance: jest.fn(),
    confirm: jest.fn<() => Promise<unknown>>(),
    expireHold: jest.fn<() => Promise<boolean>>(),
  };
  const gateway = new FlightBookingGateway(
    service as never,
    { get: () => 'usd' } as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    service.findForPayment.mockResolvedValue(booking);
  });

  it('maps the flight booking into Member 4 payment fields', async () => {
    await expect(gateway.findById(booking.id)).resolves.toEqual({
      id: booking.id,
      type: 'flight',
      userId: booking.userId,
      status: 'PendingPayment',
      totalAmount: 250.5,
      currency: 'usd',
      holdExpiresAt: booking.holdExpiresAt,
      policiesAcceptedAt: null,
      policySnapshot: null,
      startsAt: booking.departureTimeUtc,
      reference: booking.reference,
    });
  });

  it('returns false for a booking that expired before verified payment confirmation', async () => {
    service.confirm.mockRejectedValue(
      new BadRequestException('Booking hold has expired'),
    );
    await expect(gateway.confirm(booking.id)).resolves.toBe(false);
    service.expireHold.mockResolvedValue(false);
    await expect(gateway.expire(booking.id)).resolves.toBe(false);
  });
});
