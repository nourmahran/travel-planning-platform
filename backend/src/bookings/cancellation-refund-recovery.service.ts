import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { BookingType } from '../common/booking';
import { RefundsService } from '../payments/refunds.service';
import { RefundReason } from '../payments/schemas/refund.schema';
import { Booking, BookingStatus } from './schemas/booking.schema';

@Injectable()
export class CancellationRefundRecoveryService {
  private readonly logger = new Logger(CancellationRefundRecoveryService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    private readonly refunds: RefundsService,
  ) {}

  @Cron('0 * * * * *', {
    name: 'retry-flight-refund-dispatch',
    waitForCompletion: true,
  })
  async retryPendingRefunds() {
    const pending = await this.bookings
      .find({
        status: BookingStatus.CANCELLED,
        refundDispatchPending: true,
        refundDispatchReason: {
          $in: [
            RefundReason.UserCancellation,
            RefundReason.ProviderCancellation,
          ],
        },
      })
      .select('_id refundDispatchReason')
      .exec();
    for (const booking of pending) {
      try {
        await this.refunds.issueRefund(
          BookingType.Flight,
          booking._id.toString(),
          booking.refundDispatchReason as RefundReason,
        );
        await this.bookings.updateOne(
          { _id: booking._id, refundDispatchPending: true },
          { $set: { refundDispatchPending: false } },
        );
      } catch (error) {
        this.logger.error(
          `Refund dispatch retry failed for booking ${booking._id.toString()}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
  }
}
