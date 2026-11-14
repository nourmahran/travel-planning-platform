import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { BookingType } from '../common/booking';
import { RefundReason } from '../payments/schemas/refund.schema';
import { FlightCancellationService } from './flight-cancellation.service';

describe('confirmed flight cancellation', () => {
  const bookings = {
    cancelConfirmedState: jest.fn(),
    markRefundDispatched: jest.fn(),
  };
  const refunds = {
    previewRefund: jest.fn(),
    assertSuccessfulPayment: jest.fn(),
    issueRefund: jest.fn(),
  };
  const service = new FlightCancellationService(
    bookings as never,
    refunds as never,
  );

  beforeEach(() => jest.resetAllMocks());

  it('releases the booking before issuing the user refund', async () => {
    const steps: string[] = [];
    refunds.previewRefund.mockReturnValue({ cancellable: true, amount: 50 });
    refunds.assertSuccessfulPayment.mockImplementation(() => {
      steps.push('payment');
    });
    bookings.cancelConfirmedState.mockImplementation(() => {
      steps.push('cancel');
      return { status: 'Cancelled' };
    });
    refunds.issueRefund.mockImplementation(() => {
      steps.push('refund');
      return { status: 'Pending' };
    });

    await expect(
      service.cancelForUser('booking-id', 'owner-id'),
    ).resolves.toMatchObject({
      booking: { status: 'Cancelled' },
      refund: { status: 'Pending' },
    });
    expect(steps).toEqual(['payment', 'cancel', 'refund']);
    expect(bookings.markRefundDispatched).toHaveBeenCalledWith('booking-id');
    expect(refunds.issueRefund).toHaveBeenCalledWith(
      BookingType.Flight,
      'booking-id',
      RefundReason.UserCancellation,
    );
  });

  it('blocks departure without changing inventory or requesting a refund', async () => {
    refunds.previewRefund.mockReturnValue({ cancellable: false });
    await expect(
      service.cancelForUser('booking-id', 'owner-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings.cancelConfirmedState).not.toHaveBeenCalled();
    expect(refunds.issueRefund).not.toHaveBeenCalled();
  });
});
