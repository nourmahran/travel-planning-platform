import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type Stripe from 'stripe';
import { BookingStatus } from '../common/booking';
import {
  type PaymentFailedEvent,
  PaymentEvents,
  type PaymentLateRefundedEvent,
  type PaymentSucceededEvent,
} from './events';
import { BookingGatewayRegistry } from './gateway/booking-gateway.registry';
import {
  NOTIFICATION_PORT,
  type NotificationPort,
} from './gateway/notification.port';
import { isDuplicateKeyError, shortMessage } from './mongo-utils';
import { RefundsService } from './refunds.service';
import {
  Payment,
  type PaymentDocument,
  PaymentStatus,
} from './schemas/payment.schema';
import { ProcessedEvent } from './schemas/processed-event.schema';
import { RefundReason } from './schemas/refund.schema';
import { StripeService } from './stripe/stripe.service';

/** Booking states meaning "this payment was already applied to the booking". */
const ALREADY_CONFIRMED: ReadonlySet<BookingStatus> = new Set([
  BookingStatus.Confirmed,
  BookingStatus.Completed,
  BookingStatus.Cancelled,
]);

/**
 * PAY-01 / PAY-03 — Stripe webhook processing.
 *
 * Why the booking is confirmed HERE and not when the client says "paid":
 * the client can lie or crash. The webhook is signed by Stripe with our
 * secret, so it is the only trustworthy proof that the money was captured.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectModel(ProcessedEvent.name)
    private readonly processedEvents: Model<ProcessedEvent>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly registry: BookingGatewayRegistry,
    private readonly refunds: RefundsService,
    private readonly stripe: StripeService,
    @Inject(NOTIFICATION_PORT) private readonly notifier: NotificationPort,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Signature check. Must use the RAW request bytes: Stripe signs the exact
   * payload, and re-serialising parsed JSON would change it.
   */
  verify(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Stripe.Event {
    if (!rawBody || !signature) {
      throw new BadRequestException('Missing Stripe signature');
    }
    try {
      return this.stripe.constructWebhookEvent(rawBody, signature);
    } catch {
      this.logger.warn('Rejected Stripe webhook with an invalid signature');
      throw new BadRequestException('Invalid signature');
    }
  }

  /**
   * Processes each Stripe event exactly once:
   *  - insert the event id first; a duplicate-key error means "already done"
   *  - if the handler fails, delete the row and return 500 so Stripe retries
   */
  async process(event: Stripe.Event): Promise<{ received: true }> {
    try {
      await this.processedEvents.create({
        eventId: event.id,
        type: event.type,
        processedAt: new Date(),
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        this.logger.log(`Duplicate Stripe event ${event.id} ignored`);
        return { received: true };
      }
      throw err;
    }

    try {
      await this.dispatch(event);
    } catch (err) {
      await this.processedEvents
        .deleteOne({ eventId: event.id })
        .catch(() => undefined);
      this.logger.error(
        `Stripe event ${event.type} ${event.id} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new InternalServerErrorException('Webhook handling failed');
    }
    return { received: true };
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.onPaymentSucceeded(event.data.object);
      case 'payment_intent.payment_failed':
        return this.onPaymentFailed(event.data.object);
      case 'payment_intent.canceled':
        return this.onPaymentCanceled(event.data.object);
      case 'refund.updated':
      case 'refund.failed':
      case 'charge.refund.updated':
        await this.refunds.syncFromStripe(event.data.object);
        return;
      default:
        // Unhandled types are acknowledged with 200 so Stripe stops resending.
        return;
    }
  }

  async onPaymentSucceeded(pi: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.payments.findOne({
      stripePaymentIntentId: pi.id,
    });
    if (!payment) {
      this.logger.warn(
        `payment_intent.succeeded for unknown PaymentIntent ${pi.id} (ignored)`,
      );
      return;
    }

    if (payment.status !== PaymentStatus.Succeeded) {
      try {
        await this.payments.updateOne(
          { _id: payment._id, status: { $ne: PaymentStatus.Succeeded } },
          {
            $set: { status: PaymentStatus.Succeeded, succeededAt: new Date() },
            $unset: { failureMessage: 1 },
          },
        );
      } catch (err) {
        // The partial unique index refused a SECOND succeeded payment for the
        // same booking: this charge is a duplicate → give the money back.
        if (isDuplicateKeyError(err))
          return this.refundDuplicateCharge(payment, pi);
        throw err;
      }
    }

    // We do not stop early when the payment was already Succeeded: if an
    // earlier delivery crashed before confirming, this retry must finish it.
    const type = payment.bookingType;
    const bookingId = String(payment.bookingId);
    const userId = String(payment.userId);
    const gateway = this.registry.get(type);

    if (await gateway.confirm(bookingId)) {
      const event: PaymentSucceededEvent = {
        bookingType: type,
        bookingId,
        userId,
        paymentId: String(payment._id),
        amount: payment.amount,
        currency: payment.currency,
        status: 'Succeeded',
      };
      this.events.emit(PaymentEvents.Succeeded, event);
      return;
    }

    const booking = await gateway.findById(bookingId);
    if (booking && ALREADY_CONFIRMED.has(booking.status)) return; // redelivery

    // LATE PAYMENT: the money arrived after the hold expired and the seats/
    // rooms were released, so the booking cannot be confirmed → refund 100%.
    this.logger.warn(
      `Late payment for ${type} booking ${bookingId}; refunding 100%`,
    );
    const refund = await this.refunds.issueRefund(
      type,
      bookingId,
      RefundReason.LatePayment,
    );
    const event: PaymentLateRefundedEvent = {
      bookingType: type,
      bookingId,
      userId,
      paymentId: String(payment._id),
      refundId: refund ? String(refund._id) : null,
      amount: payment.amount,
      currency: payment.currency,
      status: refund?.status ?? null,
    };
    this.events.emit(PaymentEvents.LateRefunded, event);
  }

  async onPaymentFailed(pi: Stripe.PaymentIntent): Promise<void> {
    const failureMessage = shortMessage(
      pi.last_payment_error?.message,
      'Payment failed',
    );
    const payment = await this.payments.findOneAndUpdate(
      { stripePaymentIntentId: pi.id, status: PaymentStatus.Pending },
      { $set: { status: PaymentStatus.Failed, failureMessage } },
      { returnDocument: 'after' },
    );
    if (!payment) return; // unknown, or not Pending anymore

    // Booking stays PendingPayment: the user can retry until the hold expires.
    const event: PaymentFailedEvent = {
      bookingType: payment.bookingType,
      bookingId: String(payment.bookingId),
      userId: String(payment.userId),
      paymentId: String(payment._id),
      amount: payment.amount,
      currency: payment.currency,
      status: 'Failed',
      failureMessage,
    };
    this.events.emit(PaymentEvents.Failed, event);
    try {
      await this.notifier.notify(
        event.userId,
        'PAYMENT_FAILED',
        `Your payment failed: ${failureMessage} You can retry before your hold expires.`,
        {
          paymentId: event.paymentId,
          bookingType: event.bookingType,
          bookingId: event.bookingId,
        },
      );
    } catch {
      this.logger.warn(
        `PAYMENT_FAILED notification for payment ${event.paymentId} failed`,
      );
    }
  }

  async onPaymentCanceled(pi: Stripe.PaymentIntent): Promise<void> {
    await this.payments.updateOne(
      {
        stripePaymentIntentId: pi.id,
        status: { $nin: [PaymentStatus.Succeeded, PaymentStatus.Cancelled] },
      },
      { $set: { status: PaymentStatus.Cancelled, cancelledAt: new Date() } },
    );
  }

  private async refundDuplicateCharge(
    payment: PaymentDocument,
    pi: Stripe.PaymentIntent,
  ): Promise<void> {
    this.logger.error(
      `Duplicate charge ${pi.id} for already-paid ${payment.bookingType} booking ${String(payment.bookingId)}; refunding it`,
    );
    const refund = await this.stripe.createRefund({
      paymentIntentId: pi.id,
      amountMinor: payment.amount,
      idempotencyKey: `refund:duplicate:${pi.id}`,
      metadata: { reason: 'DuplicatePayment', paymentId: String(payment._id) },
    });
    await this.payments.updateOne(
      { _id: payment._id },
      {
        $set: {
          status: PaymentStatus.Cancelled,
          cancelledAt: new Date(),
          failureMessage: 'Duplicate payment refunded automatically',
          duplicateRefundId: refund.id,
        },
      },
    );
  }
}
