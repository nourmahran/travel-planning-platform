import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type Stripe from 'stripe';
import {
  assertPlatformCurrency,
  BookingType,
  fromMinorUnits,
  getPlatformCurrency,
  toMinorUnits,
} from '../common/booking';
import { type AuthUser, isAdmin } from './auth/auth-user';
import {
  assertHoldActive,
  assertPendingPayment,
  loadOwnedBooking,
} from './booking-access';
import type { CreatePaymentDto } from './dto/create-payment.dto';
import type {
  CreatePaymentResponseDto,
  DevConfirmResponseDto,
  PaymentResponseDto,
} from './dto/responses.dto';
import type { PayableBooking } from './gateway/booking-gateway.interface';
import { BookingGatewayRegistry } from './gateway/booking-gateway.registry';
import { isDuplicateKeyError, toObjectId } from './mongo-utils';
import {
  Payment,
  type PaymentDocument,
  PaymentStatus,
} from './schemas/payment.schema';
import { StripeService, type TestPaymentMethod } from './stripe/stripe.service';

/** PaymentIntent states in which the user can still (re)submit a card. */
const REUSABLE_PI_STATUSES: ReadonlySet<string> = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
]);

/** PaymentIntent states where money may already be moving — never cancel/replace. */
const IN_PROGRESS_PI_STATUSES: ReadonlySet<string> = new Set([
  'processing',
  'requires_capture',
  'succeeded',
]);

/**
 * PAY-01 — Stripe payments for bookings in their hold period.
 *
 * The flow:
 *  1. Client calls POST /api/payments → we validate the booking and create a
 *     PaymentIntent for the amount stored on the booking (never from the client).
 *  2. Client confirms the PaymentIntent with Stripe Elements using the
 *     clientSecret. Card details go straight to Stripe, never to us.
 *  3. Stripe calls our webhook; only then is the booking confirmed
 *     (see WebhookService.onPaymentSucceeded).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly currency: string;

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly registry: BookingGatewayRegistry,
    private readonly stripe: StripeService,
    config: ConfigService,
  ) {
    this.currency = getPlatformCurrency(config);
  }

  async createPayment(
    user: AuthUser,
    dto: CreatePaymentDto,
    now: Date = new Date(),
  ): Promise<CreatePaymentResponseDto> {
    const gateway = this.registry.get(dto.bookingType);
    // Check 1: exists and owned (404 otherwise)
    const booking = await loadOwnedBooking(gateway, dto.bookingId, user.id);
    // Checks 2–7
    const amountMinor = await this.assertPayable(booking, now);

    // Re-use an open PaymentIntent instead of creating a second one.
    const pending = await this.payments.findOne(
      {
        bookingType: booking.type,
        bookingId: toObjectId(booking.id),
        status: PaymentStatus.Pending,
      },
      null,
      { sort: { createdAt: -1 } },
    );
    if (pending) {
      const pi = await this.stripe.retrievePaymentIntent(
        pending.stripePaymentIntentId,
      );
      if (this.isReusable(pi, amountMinor)) {
        return this.toCreateResponse(pending, pi, booking);
      }
      await this.closePayment(pending, pi, now);
    }
    return this.startNewPaymentIntent(booking, user.id, amountMinor);
  }

  async retryPayment(
    user: AuthUser,
    paymentId: string,
    now: Date = new Date(),
  ): Promise<CreatePaymentResponseDto> {
    const payment = await this.findOwnedPayment(user, paymentId, false);
    if (payment.status === PaymentStatus.Succeeded) {
      throw new ConflictException('Booking already paid');
    }
    if (payment.status === PaymentStatus.Cancelled) {
      throw new ConflictException(
        'Payment was cancelled. Create a new payment for this booking.',
      );
    }
    const pi = await this.stripe.retrievePaymentIntent(
      payment.stripePaymentIntentId,
    );
    if (
      payment.status === PaymentStatus.Pending &&
      pi.status !== 'requires_payment_method'
    ) {
      throw new ConflictException('Payment is not retryable');
    }

    const gateway = this.registry.get(payment.bookingType);
    const booking = await loadOwnedBooking(
      gateway,
      String(payment.bookingId),
      user.id,
    );
    const amountMinor = await this.assertPayable(booking, now);

    if (
      pi.status === 'requires_payment_method' &&
      this.isReusable(pi, amountMinor)
    ) {
      // Stripe puts a declined PaymentIntent back to requires_payment_method,
      // so the same PaymentIntent can be confirmed again with a new card.
      const updated = await this.payments.findOneAndUpdate(
        {
          _id: payment._id,
          status: { $in: [PaymentStatus.Failed, PaymentStatus.Pending] },
        },
        {
          $set: { status: PaymentStatus.Pending },
          $unset: { failureMessage: 1 },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after' },
      );
      if (!updated) throw new ConflictException('Payment is not retryable');
      return this.toCreateResponse(updated, pi, booking);
    }

    await this.closePayment(payment, pi, now);
    return this.startNewPaymentIntent(booking, user.id, amountMinor);
  }

  async getPayment(
    user: AuthUser,
    paymentId: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.findOwnedPayment(user, paymentId, true);
    return toPaymentResponse(payment);
  }

  /**
   * Called by the hold-expiry job (Part 2) after a booking moved to Expired:
   * cancels every open PaymentIntent so the user can no longer pay.
   * Safe to call many times — errors are logged and the next run retries.
   */
  async cancelForExpiredBooking(
    type: BookingType,
    bookingId: string,
    now: Date = new Date(),
  ): Promise<{ cancelled: number }> {
    const open = await this.payments.find({
      bookingType: type,
      bookingId: toObjectId(bookingId),
      status: { $in: [PaymentStatus.Pending, PaymentStatus.Failed] },
    });
    let cancelled = 0;
    for (const payment of open) {
      try {
        const result = await this.stripe.cancelPaymentIntent(
          payment.stripePaymentIntentId,
        );
        if (!result) {
          // Stripe refused: either already canceled (fine) or it succeeded
          // at the last second — then the webhook issues a LatePayment refund.
          const pi = await this.stripe.retrievePaymentIntent(
            payment.stripePaymentIntentId,
          );
          if (pi.status !== 'canceled') continue;
        }
        const res = await this.payments.updateOne(
          {
            _id: payment._id,
            status: { $in: [PaymentStatus.Pending, PaymentStatus.Failed] },
          },
          { $set: { status: PaymentStatus.Cancelled, cancelledAt: now } },
        );
        if (res.modifiedCount > 0) cancelled++;
      } catch (err) {
        this.logger.warn(
          `Could not cancel payment ${String(payment._id)} for expired ${type} booking ${bookingId}: ${errorMessage(err)}`,
        );
      }
    }
    return { cancelled };
  }

  /** The successful payment of a booking (used by refunds), or null. */
  findSucceededPayment(
    type: BookingType,
    bookingId: string,
  ): Promise<PaymentDocument | null> {
    return this.payments.findOne({
      bookingType: type,
      bookingId: toObjectId(bookingId),
      status: PaymentStatus.Succeeded,
    });
  }

  /**
   * DEV ONLY (Task 12): confirm the PaymentIntent with a Stripe test token so
   * the flow can be demoed in Swagger. It does NOT confirm the booking — the
   * webhook still does that, exactly like in production.
   */
  async devConfirm(
    user: AuthUser,
    paymentId: string,
    testPaymentMethod: TestPaymentMethod,
  ): Promise<DevConfirmResponseDto> {
    const payment = await this.findOwnedPayment(user, paymentId, false);
    if (payment.status !== PaymentStatus.Pending) {
      throw new ConflictException(
        `Payment is ${payment.status}; only Pending payments can be confirmed (use retry for Failed ones)`,
      );
    }
    const pi = await this.stripe.confirmTestPaymentIntent(
      payment.stripePaymentIntentId,
      testPaymentMethod,
    );
    return {
      paymentId: String(payment._id),
      paymentIntentStatus: pi.status,
      message:
        'Confirmation sent to Stripe. The booking is confirmed only when the payment_intent.succeeded webhook arrives.',
    };
  }

  // ---------------------------------------------------------------------------

  /**
   * Checks 2–7 of the PAY-01 table (check 1, ownership, is done when loading).
   * Returns the amount to charge in minor units — always from the booking.
   */
  private async assertPayable(
    booking: PayableBooking,
    now: Date,
  ): Promise<number> {
    assertPendingPayment(booking); // 2 → 409
    assertHoldActive(booking, now); // 3 → 410
    if (!booking.policiesAcceptedAt) {
      // 4 → 400 (PAY-02)
      throw new BadRequestException('Policies must be accepted before payment');
    }
    assertPlatformCurrency(booking.currency, this.currency); // 5 → 400 (PAY-04)

    const alreadyPaid = await this.payments.exists({
      bookingType: booking.type,
      bookingId: toObjectId(booking.id),
      status: PaymentStatus.Succeeded,
    });
    if (alreadyPaid) throw new ConflictException('Booking already paid'); // 6

    let amountMinor: number;
    try {
      amountMinor = toMinorUnits(booking.totalAmount);
    } catch {
      amountMinor = 0;
    }
    if (amountMinor <= 0) {
      throw new BadRequestException('Booking amount must be greater than 0'); // 7
    }
    return amountMinor;
  }

  private isReusable(pi: Stripe.PaymentIntent, amountMinor: number): boolean {
    return (
      REUSABLE_PI_STATUSES.has(pi.status) &&
      pi.amount === amountMinor &&
      pi.currency === this.currency
    );
  }

  /** Cancel an old PaymentIntent before replacing it with a new one. */
  private async closePayment(
    payment: PaymentDocument,
    pi: Stripe.PaymentIntent,
    now: Date,
  ): Promise<void> {
    if (IN_PROGRESS_PI_STATUSES.has(pi.status)) {
      throw new ConflictException(
        'A payment for this booking is already being processed',
      );
    }
    if (pi.status !== 'canceled') {
      const cancelled = await this.stripe.cancelPaymentIntent(pi.id);
      if (!cancelled) {
        const latest = await this.stripe.retrievePaymentIntent(pi.id);
        if (latest.status !== 'canceled') {
          throw new ConflictException(
            'A payment for this booking is already being processed',
          );
        }
      }
    }
    await this.payments.updateOne(
      {
        _id: payment._id,
        status: { $in: [PaymentStatus.Pending, PaymentStatus.Failed] },
      },
      { $set: { status: PaymentStatus.Cancelled, cancelledAt: now } },
    );
  }

  private async startNewPaymentIntent(
    booking: PayableBooking,
    userId: string,
    amountMinor: number,
  ): Promise<CreatePaymentResponseDto> {
    const bookingId = toObjectId(booking.id);
    const attempt =
      (await this.payments.countDocuments({
        bookingType: booking.type,
        bookingId,
      })) + 1;

    // Same key for the same attempt → two concurrent requests get the SAME
    // PaymentIntent back from Stripe instead of creating two.
    const pi = await this.stripe.createPaymentIntent({
      amountMinor,
      currency: this.currency,
      metadata: {
        bookingType: booking.type,
        bookingId: booking.id,
        userId,
        paymentRecordVersion: '1',
      },
      idempotencyKey: `pi:${booking.type}:${booking.id}:${attempt}`,
    });

    let payment: PaymentDocument;
    try {
      payment = await this.payments.create({
        bookingType: booking.type,
        bookingId,
        userId: toObjectId(userId),
        stripePaymentIntentId: pi.id,
        amount: amountMinor,
        currency: this.currency,
        status: PaymentStatus.Pending,
        attempts: 1,
      });
    } catch (err) {
      // A concurrent request already saved this PaymentIntent.
      if (!isDuplicateKeyError(err)) throw err;
      const existing = await this.payments.findOne({
        stripePaymentIntentId: pi.id,
      });
      if (!existing) throw err;
      payment = existing;
    }
    return this.toCreateResponse(payment, pi, booking);
  }

  private async findOwnedPayment(
    user: AuthUser,
    paymentId: string,
    allowAdmin: boolean,
  ): Promise<PaymentDocument> {
    const payment = await this.payments.findById(paymentId);
    const allowed =
      payment &&
      (String(payment.userId) === user.id || (allowAdmin && isAdmin(user)));
    if (!payment || !allowed) throw new NotFoundException('Payment not found');
    return payment;
  }

  private toCreateResponse(
    payment: PaymentDocument,
    pi: Stripe.PaymentIntent,
    booking: PayableBooking,
  ): CreatePaymentResponseDto {
    if (!pi.client_secret) {
      throw new ConflictException('Payment is not available for confirmation');
    }
    return {
      paymentId: String(payment._id),
      clientSecret: pi.client_secret,
      amount: fromMinorUnits(payment.amount),
      currency: payment.currency,
      status: payment.status,
      holdExpiresAt: booking.holdExpiresAt,
    };
  }
}

export function toPaymentResponse(
  payment: PaymentDocument,
): PaymentResponseDto {
  return {
    id: String(payment._id),
    bookingType: payment.bookingType,
    bookingId: String(payment.bookingId),
    amount: fromMinorUnits(payment.amount),
    currency: payment.currency,
    status: payment.status,
    failureMessage: payment.failureMessage ?? null,
    attempts: payment.attempts,
    createdAt: payment.createdAt ?? null,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
