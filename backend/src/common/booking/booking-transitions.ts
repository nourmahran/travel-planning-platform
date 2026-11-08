import { ConflictException } from '@nestjs/common';
import { BookingStatus } from './booking-status.enum';

/**
 * GEN-11 — the ONLY allowed booking status transitions.
 * Every service that changes a booking status must go through this table
 * (assertTransition) or use allowedFromStatuses() in a conditional DB update.
 */
const ALLOWED: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  [BookingStatus.PendingPayment]: [
    BookingStatus.Confirmed,
    BookingStatus.Expired,
  ],
  [BookingStatus.Confirmed]: [BookingStatus.Completed, BookingStatus.Cancelled],
  [BookingStatus.Completed]: [],
  [BookingStatus.Expired]: [],
  [BookingStatus.Cancelled]: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** Throws 409 Conflict when the transition is not allowed by GEN-11. */
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(
      `Invalid booking status transition: ${from} -> ${to}`,
    );
  }
}

/**
 * The statuses a booking may be in right before moving to `to`.
 * Use it in conditional (atomic) updates so a status can never be skipped:
 *
 *   findOneAndUpdate(
 *     { _id, status: { $in: allowedFromStatuses(BookingStatus.Confirmed) } },
 *     { $set: { status: BookingStatus.Confirmed } },
 *   )
 */
export function allowedFromStatuses(to: BookingStatus): BookingStatus[] {
  return (Object.keys(ALLOWED) as BookingStatus[]).filter((from) =>
    ALLOWED[from].includes(to),
  );
}
