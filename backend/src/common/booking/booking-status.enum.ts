/**
 * GEN-11 — Booking lifecycle shared by flight bookings and hotel reservations.
 *
 *   PendingPayment ──► Confirmed ──► Completed
 *        │                 │
 *        ▼                 ▼
 *     Expired          Cancelled
 *
 * The allowed transitions are enforced in ./booking-transitions.ts.
 */
export enum BookingStatus {
  PendingPayment = 'PendingPayment',
  Confirmed = 'Confirmed',
  Completed = 'Completed',
  Expired = 'Expired',
  Cancelled = 'Cancelled',
}
