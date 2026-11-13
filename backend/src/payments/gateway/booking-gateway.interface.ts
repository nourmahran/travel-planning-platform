import type { BookingStatus, BookingType } from '../../common/booking';

/**
 * The contract between the payments module and the booking modules
 * (flight bookings — Member 2, hotel reservations — Member 3).
 *
 * Payments never imports flight/hotel code directly. Each booking module
 * provides one BookingGateway and registers it in BookingGatewayRegistry.
 * That keeps the modules decoupled and lets the payment logic be unit-tested
 * with an in-memory fake gateway.
 */

/** FLT-09 / HTL-10: one cancellation tier = threshold in days + refund %. */
export interface CancellationTier {
  /** Unique integer >= 0. Applies when daysRemaining >= daysBefore. */
  daysBefore: number;
  /** 0–100 */
  refundPercent: number;
}

export interface FlightPolicies {
  kind: 'flight';
  cancellationTiers: CancellationTier[];
  baggage: {
    freeBagsPerPassenger: number;
    maxWeightKgPerBag: number;
    /** platform currency, major units */
    extraBagPrice: number;
    maxExtraBagsPerPassenger: number;
  };
}

export interface HotelPolicies {
  kind: 'hotel';
  cancellationTiers: CancellationTier[];
  /** "HH:mm" */
  checkInTime: string;
  /** "HH:mm" */
  checkOutTime: string;
}

export type ProviderPolicies = FlightPolicies | HotelPolicies;

/** The view of a booking that the payments module needs. */
export interface PayableBooking {
  id: string;
  type: BookingType;
  userId: string;
  status: BookingStatus;
  /** major units, platform currency (e.g. 199.99) */
  totalAmount: number;
  currency: string;
  holdExpiresAt: Date | null;
  policiesAcceptedAt: Date | null;
  /** The policies the user accepted (PAY-02). Refunds use THIS, not live policies. */
  policySnapshot: ProviderPolicies | null;
  /** flight: outbound departure (UTC instant); hotel: check-in date (UTC midnight) */
  startsAt: Date;
  reference?: string | null;
}

export interface BookingGateway {
  readonly type: BookingType;

  findById(bookingId: string): Promise<PayableBooking | null>;

  /** The provider's CURRENT policies (airline or hotel). */
  getProviderPolicies(bookingId: string): Promise<ProviderPolicies>;

  /** Stores policiesAcceptedAt + policySnapshot on the booking. */
  savePolicyAcceptance(
    bookingId: string,
    snapshot: ProviderPolicies,
    acceptedAt: Date,
  ): Promise<void>;

  /**
   * Conditional: only PendingPayment -> Confirmed.
   * Returns false if the booking was not PendingPayment (e.g. already Expired).
   */
  confirm(bookingId: string): Promise<boolean>;

  /**
   * Conditional: only PendingPayment -> Expired, and releases inventory.
   * Returns false if the booking was not PendingPayment.
   */
  expire(bookingId: string): Promise<boolean>;
}
