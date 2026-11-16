import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import type { Model } from 'mongoose';
import { BookingStatus, BookingType } from '../common/booking';
import { BookingGatewayRegistry } from './gateway/booking-gateway.registry';
import { PaymentsService } from './payments.service';
import {
  Payment,
  type PaymentDocument,
  PaymentStatus,
} from './schemas/payment.schema';

/** Booking states in which an open PaymentIntent must not stay payable. */
const CLOSED_STATUSES = new Set<BookingStatus>([
  BookingStatus.Expired,
  BookingStatus.Cancelled,
]);

/**
 * PAY-01: "when the hold expires the PaymentIntent is cancelled".
 *
 * The flight and hotel modules expire their own holds. This job makes sure the
 * matching Stripe PaymentIntent is cancelled too, without those modules having
 * to call payments: every minute it looks at open payments (Pending / Failed)
 * and cancels them when their booking is Expired or Cancelled.
 */
@Injectable()
export class PaymentExpirySweeper {
  private readonly logger = new Logger(PaymentExpirySweeper.name);

  constructor(
    @InjectModel(Payment.name)
    private readonly payments: Model<PaymentDocument>,
    private readonly registry: BookingGatewayRegistry,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Cron('0 * * * * *', { name: 'cancel-expired-payment-intents' })
  async sweep(now: Date = new Date()): Promise<{ cancelled: number }> {
    const open = await this.payments
      .find({ status: { $in: [PaymentStatus.Pending, PaymentStatus.Failed] } })
      .select('bookingType bookingId')
      .lean()
      .exec();

    const seen = new Set<string>();
    let cancelled = 0;
    for (const payment of open) {
      const type = payment.bookingType as BookingType;
      const bookingId = String(payment.bookingId);
      const key = `${type}:${bookingId}`;
      if (seen.has(key) || !this.registry.isRegistered(type)) continue;
      seen.add(key);
      try {
        const booking = await this.registry.get(type).findById(bookingId);
        if (booking && !CLOSED_STATUSES.has(booking.status)) continue;
        const result = await this.paymentsService.cancelForExpiredBooking(
          type,
          bookingId,
          now,
        );
        cancelled += result.cancelled;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Expiry sweep failed for ${key}: ${message}`);
      }
    }
    return { cancelled };
  }
}
