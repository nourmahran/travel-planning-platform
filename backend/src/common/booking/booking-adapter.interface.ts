import type { ClientSession } from 'mongoose';
import { BookingStatus } from './booking-status.enum';
import { BookingType } from './booking-type.enum';

/**
 * Contract between the payments module (Member 4) and the booking modules
 * (Member 2 = flights, Member 3 = hotels).
 *
 * Members 2 and 3 implement BookingPaymentAdapter and provide it under the
 * injection tokens below. Payments only talks to bookings through this
 * interface, so it never imports their schemas or services directly.
 */
export const FLIGHT_BOOKING_ADAPTER = 'FLIGHT_BOOKING_ADAPTER';
export const HOTEL_BOOKING_ADAPTER = 'HOTEL_BOOKING_ADAPTER';

/** The booking fields payments needs (CLAUDE.md §4.3). */
export interface PayableBooking {
  id: string;
  type: BookingType;
  userId: string;
  status: BookingStatus;
  /** Total price in the platform currency (PAY-04). */
  totalAmount: number;
  /** Must equal PLATFORM_CURRENCY (PAY-04). */
  currency: string;
  /** End of the seat/room hold (FLT-22 / HTL-18). */
  holdExpiresAt: Date;
  /** airlineId (flight) or hotelId (hotel). */
  providerId: string;
  /** Date refund tiers count down to: outbound departureUtc (flight) or checkInDate (hotel). */
  refundReferenceDate: Date;
}

/** One cancellation tier (FLT-09 / HTL-10): cancel ≥ daysBefore days ahead → refundPercent. */
export interface CancellationTier {
  daysBefore: number;
  refundPercent: number;
}

/** Airline baggage rules shown before payment (FLT-04 / FLT-08). */
export interface BaggagePolicy {
  /** Free checked bags per cabin class, e.g. { ECONOMY: 1, BUSINESS: 2 }. */
  freeAllowanceByCabin: Record<string, number>;
  extraBagPrice: number;
  maxExtraBags: number;
  maxWeightKg: number;
}

/** Policies shown to the user before payment and snapshotted on acceptance (PAY-02). */
export type ProviderPolicySnapshot =
  | {
      type: BookingType.FLIGHT;
      providerId: string;
      providerName?: string;
      cancellationTiers: CancellationTier[];
      baggagePolicy: BaggagePolicy;
    }
  | {
      type: BookingType.HOTEL;
      providerId: string;
      providerName?: string;
      cancellationTiers: CancellationTier[];
      /** Local time "HH:mm" (HTL-09). */
      checkInTime: string;
      checkOutTime: string;
    };

export interface BookingPaymentAdapter {
  /** Returns the booking in payment shape, or null if it does not exist. */
  findForPayment(bookingId: string): Promise<PayableBooking | null>;

  /** PAY-02: airline → cancellation tiers + baggage policy; hotel → cancellation tiers + check-in/out times. */
  getPolicies(bookingId: string): Promise<ProviderPolicySnapshot>;

  /**
   * PENDING_PAYMENT → CONFIRMED atomically. Converts held seats/rooms to booked,
   * generates the booking reference, sends the confirmation notification
   * (FLT-23 / HTL-17). Returns false if the booking was not in PENDING_PAYMENT.
   * Must run inside the given session (payments wraps it in a transaction).
   */
  confirmAfterPayment(bookingId: string, session?: ClientSession): Promise<boolean>;

  /** PENDING_PAYMENT → EXPIRED atomically + release held seats/rooms (FLT-22 / HTL-18). */
  expireHold(bookingId: string): Promise<boolean>;

  /** CONFIRMED → COMPLETED (needed for HTL-23 reviews). */
  markCompleted(bookingId: string): Promise<boolean>;

  /** For the scheduler: PENDING_PAYMENT bookings whose holdExpiresAt <= now. */
  findExpiredHoldIds(now: Date): Promise<string[]>;

  /** For the scheduler: CONFIRMED bookings whose completion date <= now. */
  findCompletableIds(now: Date): Promise<string[]>;
}
