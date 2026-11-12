/**
 * GEN-11 — Booking lifecycle statuses.
 *
 * Shared by flight bookings (Member 2), hotel bookings (Member 3) and
 * payments (Member 4). Everyone imports this file; nobody redefines it.
 *
 * The string values are what is stored in MongoDB, so they must never change
 * once data exists.
 */
export enum BookingStatus {
  /** Seats/rooms are held; waiting for a successful Stripe payment. */
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  /** Payment succeeded (confirmed by webhook); booking reference generated. */
  CONFIRMED = 'CONFIRMED',
  /** The trip/stay has happened (flight departed / hotel check-out passed). */
  COMPLETED = 'COMPLETED',
  /** The hold ran out before payment succeeded; inventory released. */
  EXPIRED = 'EXPIRED',
  /** A confirmed booking was cancelled by the user or the provider. */
  CANCELLED = 'CANCELLED',
}
