import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingType } from '../common/booking';
import { RefundsService } from '../payments/refunds.service';
import { RefundReason } from '../payments/schemas/refund.schema';
import { BookingsService } from './bookings.service';

@Injectable()
export class FlightCancellationService {
  constructor(
    private readonly bookings: BookingsService,
    private readonly refunds: RefundsService,
  ) {}

  async previewForUser(bookingId: string, userId: string) {
    const [original, adjustment] = await Promise.all([
      this.refunds.previewRefund(BookingType.Flight, bookingId, userId),
      this.refunds.previewChangedFlightRefund(bookingId, userId),
    ]);
    return adjustment ? { ...original, amount: Math.round((original.amount + adjustment.amount) * 100) / 100 } : original;
  }

  async cancelForUser(bookingId: string, userId: string) {
    const preview = await this.previewForUser(bookingId, userId);
    if (!preview.cancellable)
      throw new BadRequestException('Flight has departed');
    await this.refunds.assertSuccessfulPayment(BookingType.Flight, bookingId);
    const booking = await this.bookings.cancelConfirmedState(bookingId, userId);
    const refund = await this.refunds.issueRefund(
      BookingType.Flight,
      bookingId,
      RefundReason.UserCancellation,
    );
    await this.refunds.issueChangedFlightRefund(bookingId, RefundReason.UserCancellation);
    await this.bookings.markRefundDispatched(bookingId);
    return { booking, refund };
  }
}
