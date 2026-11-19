import type { BookingType } from '../common/booking';
import type { RefundReason, RefundStatus } from './schemas/refund.schema';

/**
 * Domain events emitted with EventEmitter2. Other modules can react without
 * the payments module knowing about them, e.g. in the flight-bookings module:
 *
 *   @OnEvent(PaymentEvents.Succeeded)
 *   async onPaid(e: PaymentSucceededEvent) { ...generate e-ticket, notify... }
 *
 * Amounts in payloads are in MINOR units (cents), platform currency.
 */
export const PaymentEvents = {
  Succeeded: 'payment.succeeded',
  Failed: 'payment.failed',
  LateRefunded: 'payment.late_refunded',
  RefundCreated: 'refund.created',
  RefundStatusChanged: 'refund.status_changed',
} as const;

export type PaymentEventName =
  (typeof PaymentEvents)[keyof typeof PaymentEvents];

interface BookingRef {
  bookingType: BookingType;
  bookingId: string;
  userId: string;
}

/** payment.succeeded — booking was moved PendingPayment -> Confirmed. */
export interface PaymentSucceededEvent extends BookingRef {
  paymentId: string;
  amount: number;
  currency: string;
  status: 'Succeeded';
}

/** payment.failed — the card was declined; booking stays PendingPayment. */
export interface PaymentFailedEvent extends BookingRef {
  paymentId: string;
  amount: number;
  currency: string;
  status: 'Failed';
  failureMessage: string;
}

/** payment.late_refunded — paid after the hold expired; refunded 100%. */
export interface PaymentLateRefundedEvent extends BookingRef {
  paymentId: string;
  refundId: string | null;
  amount: number;
  currency: string;
  status: RefundStatus | null;
}

/** refund.created — a refund record was created and sent to Stripe. */
export interface RefundCreatedEvent extends BookingRef {
  refundId: string;
  paymentId: string;
  amount: number;
  percent: number;
  currency: string;
  reason: RefundReason;
  status: RefundStatus;
}

/** refund.status_changed — Stripe reported a new refund status. */
export interface RefundStatusChangedEvent extends BookingRef {
  refundId: string;
  amount: number;
  currency: string;
  previousStatus: RefundStatus;
  status: RefundStatus;
}
