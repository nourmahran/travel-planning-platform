import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import {
  BookingStatus as SharedStatus,
  BookingType,
  getPlatformCurrency,
} from '../common/booking';
import type {
  BookingGateway,
  FlightPolicies,
  PayableBooking,
  ProviderPolicies,
} from '../payments/gateway/booking-gateway.interface';
import { BookingGatewayRegistry } from '../payments/gateway/booking-gateway.registry';
import { BookingsService } from './bookings.service';
import { BookingStatus } from './schemas/booking.schema';

/**
 * PAY-01 / PAY-02 / GEN-11 — connects Member 2's flight bookings to the
 * payments module (Member 4).
 *
 * Payments never reads the flight booking collection directly. It only calls
 * the 5 BookingGateway methods below, which wrap BookingsService.
 */

/** Flight module status strings → shared GEN-11 statuses used by payments. */
const STATUS_MAP: Record<BookingStatus, SharedStatus> = {
  [BookingStatus.PENDING]: SharedStatus.PendingPayment, // legacy rows
  [BookingStatus.PENDING_PAYMENT]: SharedStatus.PendingPayment,
  [BookingStatus.CONFIRMED]: SharedStatus.Confirmed,
  [BookingStatus.COMPLETED]: SharedStatus.Completed,
  [BookingStatus.EXPIRED]: SharedStatus.Expired,
  [BookingStatus.CANCELLED]: SharedStatus.Cancelled,
};

@Injectable()
export class FlightBookingGateway implements BookingGateway, OnModuleInit {
  readonly type = BookingType.Flight;

  constructor(
    private readonly bookings: BookingsService,
    private readonly registry: BookingGatewayRegistry,
    private readonly config: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Register with payments on startup, so flight payments stop returning 503. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /** PAY-01: the booking fields payments needs, in the shared shape. */
  async findById(bookingId: string): Promise<PayableBooking | null> {
    const view = await this.bookings.findForPayment(bookingId);
    if (!view) return null;
    return {
      id: view.id,
      type: BookingType.Flight,
      userId: view.userId,
      status: STATUS_MAP[view.status],
      totalAmount: view.totalPrice,
      currency: getPlatformCurrency(this.config), // PAY-04: one platform currency
      holdExpiresAt: view.holdExpiresAt ?? null,
      policiesAcceptedAt: view.policiesAcceptedAt ?? null,
      policySnapshot:
        (view.policySnapshot as FlightPolicies | undefined) ?? null,
      startsAt: view.departureTimeUtc, // refund tiers count down to outbound departure
      reference: view.reference ?? null,
    };
  }

  /** PAY-02: airline cancellation tiers + baggage policy for the booked cabin. */
  getProviderPolicies(bookingId: string): Promise<ProviderPolicies> {
    return this.bookings.getCurrentPolicies(bookingId);
  }

  /** PAY-02: store acceptance + snapshot on the booking (only during an active hold). */
  savePolicyAcceptance(
    bookingId: string,
    snapshot: ProviderPolicies,
    acceptedAt: Date,
  ): Promise<void> {
    if (snapshot.kind !== 'flight') {
      throw new BadRequestException('Expected flight policies');
    }
    return this.bookings.savePolicyAcceptance(bookingId, snapshot, acceptedAt);
  }

  /**
   * PAY-01 / FLT-23: PendingPayment → Confirmed, called only by the verified
   * Stripe webhook. BookingsService.confirm() requires a transaction, so the
   * gateway opens one here. Returns false (instead of throwing) when the booking
   * can't be confirmed, e.g. the hold already expired: the webhook then refunds
   * the payment automatically.
   */
  async confirm(bookingId: string): Promise<boolean> {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.bookings.confirm(bookingId, session);
      });
      return true;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        return false;
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /** FLT-22 / GEN-11: PendingPayment → Expired and release the held seats. */
  expire(bookingId: string): Promise<boolean> {
    return this.bookings.expireHold(bookingId);
  }
}
