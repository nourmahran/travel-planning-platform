import { ConflictException } from '@nestjs/common';
import { BookingStatus } from './booking-status.enum';

/**
 * GEN-11 — The only allowed booking status transitions.
 *
 *   PENDING_PAYMENT ──► CONFIRMED ──► COMPLETED
 *         │                 │
 *         ▼                 ▼
 *      EXPIRED          CANCELLED
 *
 * COMPLETED, EXPIRED and CANCELLED are final: nothing can leave them.
 * A status "changing" to itself is also not a transition, so it is rejected.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<BookingStatus, readonly BookingStatus[]>
> = Object.freeze({
  [BookingStatus.PENDING_PAYMENT]: [BookingStatus.CONFIRMED, BookingStatus.EXPIRED],
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.EXPIRED]: [],
  [BookingStatus.CANCELLED]: [],
});

/** GEN-11 — true if `from → to` is an allowed transition. */
export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * GEN-11 — throws 409 `INVALID_STATUS_TRANSITION` if `from → to` is not allowed.
 *
 * This is a validation step only. The actual status change must still be an
 * atomic conditional update that filters on the expected `from` status, e.g.
 *
 *   model.findOneAndUpdate(
 *     { _id: id, status: BookingStatus.PENDING_PAYMENT },
 *     { $set: { status: BookingStatus.CONFIRMED } },
 *     { new: true, session },
 *   );
 *
 * so two concurrent writers (webhook vs. expiry job) can never both succeed.
 */
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException({
      code: 'INVALID_STATUS_TRANSITION',
      message: `Booking status cannot change from ${from} to ${to}`,
    });
  }
}
