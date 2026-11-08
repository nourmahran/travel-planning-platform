import { BookingStatus, BookingType } from '../../common/booking';
import type {
  BookingGateway,
  PayableBooking,
  ProviderPolicies,
} from '../gateway/booking-gateway.interface';

export const FLIGHT_POLICIES: ProviderPolicies = {
  kind: 'flight',
  cancellationTiers: [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 0, refundPercent: 0 },
  ],
  baggage: {
    freeBagsPerPassenger: 1,
    maxWeightKgPerBag: 23,
    extraBagPrice: 50,
    maxExtraBagsPerPassenger: 2,
  },
};

export const HOTEL_POLICIES: ProviderPolicies = {
  kind: 'hotel',
  cancellationTiers: [
    { daysBefore: 14, refundPercent: 100 },
    { daysBefore: 3, refundPercent: 50 },
  ],
  checkInTime: '14:00',
  checkOutTime: '12:00',
};

/**
 * In-memory BookingGateway used by unit tests instead of the real
 * flight/hotel booking modules (which are owned by other members).
 */
export class FakeBookingGateway implements BookingGateway {
  readonly bookings = new Map<string, PayableBooking>();
  policies: ProviderPolicies;
  confirmCalls = 0;
  expireCalls = 0;
  savePolicyCalls = 0;

  constructor(readonly type: BookingType) {
    this.policies =
      type === BookingType.Hotel ? HOTEL_POLICIES : FLIGHT_POLICIES;
  }

  seed(
    overrides: Partial<PayableBooking> & { id: string; userId: string },
  ): PayableBooking {
    const booking: PayableBooking = {
      type: this.type,
      status: BookingStatus.PendingPayment,
      totalAmount: 250.5,
      currency: 'usd',
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
      policiesAcceptedAt: null,
      policySnapshot: null,
      startsAt: new Date(Date.now() + 40 * 86_400_000),
      reference: null,
      ...overrides,
    };
    this.bookings.set(booking.id, booking);
    return booking;
  }

  setStatus(id: string, status: BookingStatus): void {
    this.mustGet(id).status = status;
  }

  setHoldExpired(id: string): void {
    this.mustGet(id).holdExpiresAt = new Date(Date.now() - 60_000);
  }

  acceptPolicies(id: string, at = new Date()): void {
    const b = this.mustGet(id);
    b.policiesAcceptedAt = at;
    b.policySnapshot = structuredClone(this.policies);
  }

  findById(bookingId: string): Promise<PayableBooking | null> {
    const b = this.bookings.get(bookingId);
    return Promise.resolve(b ? { ...b } : null);
  }

  getProviderPolicies(): Promise<ProviderPolicies> {
    return Promise.resolve(structuredClone(this.policies));
  }

  savePolicyAcceptance(
    bookingId: string,
    snapshot: ProviderPolicies,
    acceptedAt: Date,
  ): Promise<void> {
    this.savePolicyCalls++;
    const b = this.mustGet(bookingId);
    b.policySnapshot = snapshot;
    b.policiesAcceptedAt = acceptedAt;
    return Promise.resolve();
  }

  confirm(bookingId: string): Promise<boolean> {
    this.confirmCalls++;
    const b = this.bookings.get(bookingId);
    if (!b || b.status !== BookingStatus.PendingPayment)
      return Promise.resolve(false);
    b.status = BookingStatus.Confirmed;
    return Promise.resolve(true);
  }

  expire(bookingId: string): Promise<boolean> {
    this.expireCalls++;
    const b = this.bookings.get(bookingId);
    if (!b || b.status !== BookingStatus.PendingPayment)
      return Promise.resolve(false);
    b.status = BookingStatus.Expired;
    return Promise.resolve(true);
  }

  private mustGet(id: string): PayableBooking {
    const b = this.bookings.get(id);
    if (!b) throw new Error(`FakeBookingGateway: no booking ${id}`);
    return b;
  }
}
