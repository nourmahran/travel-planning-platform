import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import type Stripe from 'stripe';
import {
  BookingStatus,
  BookingType,
  fromMinorUnits,
  getPlatformCurrency,
  toMinorUnits,
} from '../common/booking';
import { type AuthUser, isAdmin } from './auth/auth-user';
import { loadOwnedBooking } from './booking-access';
import type { RefundPreviewDto, RefundResponseDto } from './dto/responses.dto';
import {
  PaymentEvents,
  type RefundCreatedEvent,
  type RefundStatusChangedEvent,
} from './events';
import type {
  BookingGateway,
  CancellationTier,
  PayableBooking,
} from './gateway/booking-gateway.interface';
import { BookingGatewayRegistry } from './gateway/booking-gateway.registry';
import {
  NOTIFICATION_PORT,
  type NotificationPort,
  type PaymentNotificationType,
} from './gateway/notification.port';
import { isDuplicateKeyError, toObjectId } from './mongo-utils';
import { calculateRefund } from './refund-calculator';
import { Payment, PaymentStatus } from './schemas/payment.schema';
import {
  Refund,
  type RefundDocument,
  RefundReason,
  RefundStatus,
} from './schemas/refund.schema';
import { StripeService } from './stripe/stripe.service';

/** Booking states in which money may be returned. */
const REFUNDABLE_BOOKING_STATUSES: ReadonlySet<BookingStatus> = new Set([
  BookingStatus.Cancelled, // user or provider cancellation (FLT-26, HTL-21, FLT-06)
  BookingStatus.Expired, // late payment after the hold expired
]);

/** Stripe refund status → our PAY-03 status (Pending, Refunded, Failed). */
export function mapStripeRefundStatus(
  status: string | null | undefined,
): RefundStatus {
  switch (status) {
    case 'succeeded':
      return RefundStatus.Refunded;
    case 'failed':
    case 'canceled':
      return RefundStatus.Failed;
    default: // pending, requires_action, null
      return RefundStatus.Pending;
  }
}

/**
 * PAY-03 — refunds through the Stripe Refunds API.
 *
 * Members 2 and 3 call:
 *  - previewRefund() before the user confirms a cancellation (shows the amount)
 *  - issueRefund() AFTER they set the booking status to Cancelled
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);
  private readonly currency: string;

  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly registry: BookingGatewayRegistry,
    private readonly stripe: StripeService,
    @Inject(NOTIFICATION_PORT) private readonly notifier: NotificationPort,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.currency = getPlatformCurrency(config);
  }

  /** What the user would get back if they cancelled now (no side effects). */
  async assertSuccessfulPayment(
    type: BookingType,
    bookingId: string,
  ): Promise<void> {
    if (!(await this.findSucceededPayment(type, bookingId))) {
      throw new ConflictException('No successful payment found');
    }
  }

  private async succeededFlightChangeId(bookingId: string): Promise<string | null> {
    const change = await this.payments.db.collection('flight_changes').findOne({
      bookingId: toObjectId(bookingId), status: 'Confirmed', amountDue: { $gt: 0 },
    });
    if (!change) return null;
    const payment = await this.findSucceededPayment(BookingType.FlightChange, String(change._id));
    return payment ? String(change._id) : null;
  }

  async previewChangedFlightRefund(bookingId: string, userId: string) {
    const changeId = await this.succeededFlightChangeId(bookingId);
    if (!changeId) return null;
    return this.previewRefund(BookingType.FlightChange, changeId, userId);
  }

  async issueChangedFlightRefund(bookingId: string, reason: RefundReason) {
    const changeId = await this.succeededFlightChangeId(bookingId);
    if (!changeId) return null;
    return this.issueRefund(BookingType.FlightChange, changeId, reason);
  }

  async previewRefund(
    type: BookingType,
    bookingId: string,
    userId: string,
    reason: RefundReason = RefundReason.UserCancellation,
    now: Date = new Date(),
  ): Promise<RefundPreviewDto> {
    const gateway = this.registry.get(type);
    const booking = await loadOwnedBooking(gateway, bookingId, userId);
    if (booking.status !== BookingStatus.Confirmed) {
      throw new ConflictException('Only confirmed bookings can be cancelled');
    }

    const payment = await this.findSucceededPayment(type, bookingId);
    const totalMinor = payment?.amount ?? toMinorUnits(booking.totalAmount);
    const currency = payment?.currency ?? this.currency;

    // FLT-26: no user cancellation after departure. HTL-21: only before check-in.
    if (
      reason === RefundReason.UserCancellation &&
      booking.startsAt.getTime() <= now.getTime()
    ) {
      return {
        percent: 0,
        amount: 0,
        currency,
        daysRemaining: 0,
        cancellable: false,
        message:
          type === BookingType.Flight
            ? 'The flight has already departed'
            : 'The check-in date has been reached',
      };
    }

    const calc = calculateRefund({
      totalAmountMinor: totalMinor,
      tiers: await this.resolveTiers(gateway, booking),
      startsAt: booking.startsAt,
      now,
      kind: type === BookingType.Hotel ? BookingType.Hotel : BookingType.Flight,
      reason,
    });
    return {
      percent: calc.percent,
      amount: fromMinorUnits(calc.amountMinor),
      currency,
      daysRemaining: calc.daysRemaining,
      cancellable: true,
    };
  }

  /**
   * Issues the refund for a cancelled (or late-paid, expired) booking.
   * Returns null when the refund amount is 0 (no Stripe call, no record).
   * Never throws because of a Stripe failure: the refund is recorded as
   * Failed so the booking cancellation itself still succeeds.
   * Idempotent: a second call returns the existing refund.
   */
  async issueRefund(
    type: BookingType,
    bookingId: string,
    reason: RefundReason,
    now: Date = new Date(),
  ): Promise<RefundDocument | null> {
    const bookingOid = toObjectId(bookingId);

    // 1. There must be money to give back.
    const payment = await this.findSucceededPayment(type, bookingId);
    if (!payment) throw new ConflictException('No successful payment found');

    // 2. One refund per booking (also enforced by a unique index).
    const existing = await this.refunds.findOne({
      bookingType: type,
      bookingId: bookingOid,
    });
    if (existing) return existing;

    const gateway = this.registry.get(type);
    const booking = await gateway.findById(bookingId);
    if (booking && !REFUNDABLE_BOOKING_STATUSES.has(booking.status)) {
      throw new ConflictException(
        'Booking must be cancelled before it can be refunded',
      );
    }
    if (!booking && reason === RefundReason.UserCancellation) {
      throw new NotFoundException('Booking not found');
    }

    // 3. Amount: computed on what was ACTUALLY paid, in integer cents.
    const calc = calculateRefund({
      totalAmountMinor: payment.amount,
      tiers:
        reason === RefundReason.UserCancellation && booking
          ? await this.resolveTiers(gateway, booking)
          : [],
      startsAt: booking?.startsAt ?? now,
      now,
      kind: type === BookingType.Hotel ? BookingType.Hotel : BookingType.Flight,
      reason,
    });

    // 4. Nothing to refund.
    if (calc.amountMinor === 0) return null;

    // 5. Record FIRST (Pending), then call Stripe. If we crash in between,
    //    the record exists and the idempotency key prevents a double refund.
    let refund: RefundDocument;
    try {
      refund = await this.refunds.create({
        paymentId: payment._id,
        bookingType: type,
        bookingId: bookingOid,
        userId: payment.userId,
        amount: calc.amountMinor,
        percent: calc.percent,
        currency: payment.currency,
        reason,
        status: RefundStatus.Pending,
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const raced = await this.refunds.findOne({
        bookingType: type,
        bookingId: bookingOid,
      });
      if (!raced) throw err;
      return raced;
    }

    const userId = String(payment.userId);
    const amountText = `${fromMinorUnits(calc.amountMinor).toFixed(2)} ${payment.currency.toUpperCase()}`;
    try {
      const stripeRefund = await this.stripe.createRefund({
        paymentIntentId: payment.stripePaymentIntentId,
        amountMinor: calc.amountMinor,
        idempotencyKey: `refund:${type}:${bookingId}`,
        metadata: {
          refundId: String(refund._id),
          bookingType: type,
          bookingId,
          reason,
        },
      });
      refund = await this.applyStripeResult(refund, stripeRefund);
      if (refund.status === RefundStatus.Failed) {
        await this.safeNotify(
          userId,
          'REFUND_FAILED',
          `Your refund of ${amountText} could not be processed.`,
          refund,
        );
      } else {
        await this.safeNotify(
          userId,
          'REFUND_ISSUED',
          `A refund of ${amountText} (${calc.percent}%) has been issued.`,
          refund,
        );
      }
    } catch (err) {
      // 7. Stripe failed: record it, tell the user, do NOT throw.
      this.logger.error(
        `Refund ${String(refund._id)} failed at Stripe: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      refund =
        (await this.refunds.findOneAndUpdate(
          { _id: refund._id },
          {
            $set: {
              status: RefundStatus.Failed,
              failureMessage:
                'Refund could not be processed by the payment provider',
            },
          },
          { returnDocument: 'after' },
        )) ?? refund;
      await this.safeNotify(
        userId,
        'REFUND_FAILED',
        `Your refund of ${amountText} could not be processed.`,
        refund,
      );
    }

    // 9. Domain event.
    const event: RefundCreatedEvent = {
      bookingType: type,
      bookingId,
      userId,
      refundId: String(refund._id),
      paymentId: String(payment._id),
      amount: refund.amount,
      percent: refund.percent,
      currency: refund.currency,
      reason,
      status: refund.status,
    };
    this.events.emit(PaymentEvents.RefundCreated, event);
    return refund;
  }

  /**
   * Webhook handler for refund.updated / refund.failed / charge.refund.updated.
   * Finds our record by Stripe refund id (or by metadata.refundId if the
   * webhook arrived before we saved the id) and updates the status.
   */
  async syncFromStripe(
    stripeRefund: Stripe.Refund,
  ): Promise<RefundDocument | null> {
    let refund = await this.refunds.findOne({
      stripeRefundId: stripeRefund.id,
    });
    const metaId = stripeRefund.metadata?.refundId;
    if (!refund && metaId && isValidObjectId(metaId)) {
      refund = await this.refunds.findById(metaId);
    }
    if (!refund) {
      this.logger.warn(
        `Stripe refund ${stripeRefund.id} does not match any refund record (ignored)`,
      );
      return null;
    }

    const previousStatus = refund.status;
    const updated = await this.applyStripeResult(refund, stripeRefund);
    if (updated.status === previousStatus) return updated;

    const event: RefundStatusChangedEvent = {
      bookingType: updated.bookingType,
      bookingId: String(updated.bookingId),
      userId: String(updated.userId),
      refundId: String(updated._id),
      amount: updated.amount,
      currency: updated.currency,
      previousStatus,
      status: updated.status,
    };
    this.events.emit(PaymentEvents.RefundStatusChanged, event);
    if (updated.status === RefundStatus.Failed) {
      await this.safeNotify(
        String(updated.userId),
        'REFUND_FAILED',
        'Your refund could not be completed by the payment provider.',
        updated,
      );
    }
    return updated;
  }

  /** Latest refund of a booking — for the booking-details endpoints (PAY-03). */
  findLatestByBooking(
    type: BookingType,
    bookingId: string,
  ): Promise<RefundDocument | null> {
    return this.refunds.findOne(
      { bookingType: type, bookingId: toObjectId(bookingId) },
      null,
      { sort: { createdAt: -1 } },
    );
  }

  /**
   * PAY-03: "show its status on the booking details". Latest refund of a
   * booking, for its owner (or an admin). 404 when there is none.
   */
  async getRefundForBooking(
    user: AuthUser,
    type: BookingType,
    bookingId: string,
  ): Promise<RefundResponseDto> {
    const refund = await this.findLatestByBooking(type, bookingId);
    if (!refund || (String(refund.userId) !== user.id && !isAdmin(user))) {
      throw new NotFoundException('No refund for this booking');
    }
    return toRefundResponse(refund);
  }

  async getRefund(
    user: AuthUser,
    refundId: string,
  ): Promise<RefundResponseDto> {
    const refund = await this.refunds.findById(refundId);
    if (!refund || (String(refund.userId) !== user.id && !isAdmin(user))) {
      throw new NotFoundException('Refund not found');
    }
    return toRefundResponse(refund);
  }

  // ---------------------------------------------------------------------------

  private findSucceededPayment(type: BookingType, bookingId: string) {
    return this.payments.findOne({
      bookingType: type,
      bookingId: toObjectId(bookingId),
      status: PaymentStatus.Succeeded,
    });
  }

  /**
   * Tiers from the policy SNAPSHOT the user accepted (PAY-02), so later edits
   * by the moderator don't change old bookings. Falls back to live policies
   * only if the snapshot is missing (should not happen for paid bookings).
   */
  private async resolveTiers(
    gateway: BookingGateway,
    booking: PayableBooking,
  ): Promise<CancellationTier[]> {
    if (booking.policySnapshot) return booking.policySnapshot.cancellationTiers;
    this.logger.warn(
      `Booking ${booking.type}/${booking.id} has no policy snapshot; using live policies for the refund`,
    );
    const live = await gateway.getProviderPolicies(booking.id);
    return live.cancellationTiers;
  }

  /**
   * Saves the Stripe refund id and the mapped status. The status update is
   * conditional so an older "pending" result can never overwrite a final
   * Refunded/Failed status that a webhook already wrote.
   */
  private async applyStripeResult(
    refund: RefundDocument,
    stripeRefund: Stripe.Refund,
  ): Promise<RefundDocument> {
    const status = mapStripeRefundStatus(stripeRefund.status);
    const set: Record<string, unknown> = { stripeRefundId: stripeRefund.id };
    const canChange =
      status !== refund.status &&
      (refund.status === RefundStatus.Pending ||
        status !== RefundStatus.Pending);
    if (canChange) {
      set.status = status;
      if (status === RefundStatus.Failed) {
        set.failureMessage = stripeRefund.failure_reason
          ? `Refund failed: ${stripeRefund.failure_reason}`
          : 'Refund failed';
      }
    }
    const updated = await this.refunds.findOneAndUpdate(
      { _id: refund._id, status: refund.status },
      { $set: set },
      { returnDocument: 'after' },
    );
    return updated ?? (await this.refunds.findById(refund._id)) ?? refund;
  }

  private async safeNotify(
    userId: string,
    type: PaymentNotificationType,
    message: string,
    refund: RefundDocument,
  ): Promise<void> {
    try {
      await this.notifier.notify(userId, type, message, {
        refundId: String(refund._id),
        bookingType: refund.bookingType,
        bookingId: String(refund.bookingId),
      });
    } catch (err) {
      this.logger.warn(
        `Notification ${type} for user ${userId} failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
}

export function toRefundResponse(refund: RefundDocument): RefundResponseDto {
  return {
    id: String(refund._id),
    bookingType: refund.bookingType,
    bookingId: String(refund.bookingId),
    amount: fromMinorUnits(refund.amount),
    percent: refund.percent,
    currency: refund.currency,
    reason: refund.reason,
    status: refund.status,
    failureMessage: refund.failureMessage ?? null,
    createdAt: refund.createdAt ?? null,
  };
}
