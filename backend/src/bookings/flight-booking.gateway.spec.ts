import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { FlightBookingGateway } from './flight-booking.gateway';
import { BookingStatus } from './schemas/booking.schema';

describe('FlightBookingGateway payment boundary', () => {
  const booking = {
    id: '507f1f77bcf86cd799439011',
    userId: '507f1f77bcf86cd799439012',
    providerId: '507f1f77bcf86cd799439013',
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
    getPaymentPolicyContext: jest.fn(),
    confirm: jest.fn<() => Promise<unknown>>(),
    expireHold: jest.fn<() => Promise<boolean>>(),
    markCompleted: jest.fn<() => Promise<boolean>>(),
    findExpiredHoldIds: jest.fn<() => Promise<string[]>>(),
    findCompletableIds: jest.fn<() => Promise<string[]>>(),
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
    await expect(gateway.findForPayment(booking.id)).resolves.toEqual({
      id: booking.id,
      type: 'flight',
      userId: booking.userId,
      status: 'PENDING_PAYMENT',
      totalAmount: 250.5,
      currency: 'usd',
      holdExpiresAt: booking.holdExpiresAt,
      providerId: booking.providerId,
      refundReferenceDate: booking.departureTimeUtc,
    });
  });

  it('returns false for a booking that expired before verified payment confirmation', async () => {
    service.confirm.mockRejectedValue(
      new BadRequestException('Booking hold has expired'),
    );
    const session = {} as never;
    await expect(
      gateway.confirmAfterPayment(booking.id, session),
    ).resolves.toBe(false);
    service.expireHold.mockResolvedValue(false);
    await expect(gateway.expireHold(booking.id)).resolves.toBe(false);
  });

  it('maps airline policies to Member 4’s policy shape', async () => {
    service.getPaymentPolicyContext.mockReturnValue({
      providerId: booking.providerId,
      cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
      baggagePolicy: {
        freeAllowanceByCabin: { Economy: 1 },
        extraBagPrice: 30,
        maxExtraBags: 2,
        maxWeightKg: 23,
      },
    });
    await expect(gateway.getPolicies(booking.id)).resolves.toMatchObject({
      type: 'flight',
      providerId: booking.providerId,
      baggagePolicy: { maxWeightKg: 23 },
    });
  });
});
