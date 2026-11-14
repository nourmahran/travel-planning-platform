import {
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus } from '../common/booking';
import type {
  BookingGateway,
  PayableBooking,
} from './gateway/booking-gateway.interface';

/**
 * Loads a booking and checks the current user owns it.
 * Missing AND not-owned both return the same 404, so a user can never find
 * out whether someone else's booking ID exists.
 */
export async function loadOwnedBooking(
  gateway: BookingGateway,
  bookingId: string,
  userId: string,
): Promise<PayableBooking> {
  const booking = await gateway.findById(bookingId);
  if (!booking || String(booking.userId) !== String(userId)) {
    throw new NotFoundException('Booking not found');
  }
  return booking;
}

export function assertPendingPayment(booking: PayableBooking): void {
  if (booking.status !== BookingStatus.PendingPayment) {
    throw new ConflictException('Booking is not awaiting payment');
  }
}

/**
 * 410 Gone when the 10-minute hold (FLT-22 / HTL-18) is over. A missing
 * holdExpiresAt on a PendingPayment booking is treated as expired (fail safe).
 */
export function assertHoldActive(booking: PayableBooking, now: Date): void {
  if (
    !booking.holdExpiresAt ||
    booking.holdExpiresAt.getTime() <= now.getTime()
  ) {
    throw new GoneException('Booking hold has expired');
  }
}
