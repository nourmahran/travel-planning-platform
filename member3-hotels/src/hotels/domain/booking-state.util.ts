import { ConflictException } from '@nestjs/common';
import { HotelBookingStatus } from '../schemas/hotel-booking.schema';

/**
 * Reservation state machine.
 *
 * PAY-19 (Member 4) owns the platform-wide booking transitions. The hotel
 * reservations deliberately expose the same statuses so both modules agree:
 *
 *   HELD --payment verified--> CONFIRMED --checkout--> COMPLETED
 *    |                            |
 *    | hold elapsed / cancelled   +--> CANCELLED (policy refund)
 *    +--> EXPIRED
 *    +--> CANCELLED (no payment taken)
 */
export const ALLOWED_TRANSITIONS: Record<HotelBookingStatus, HotelBookingStatus[]> = {
  [HotelBookingStatus.HELD]: [
    HotelBookingStatus.CONFIRMED,
    HotelBookingStatus.CANCELLED,
    HotelBookingStatus.EXPIRED,
  ],
  [HotelBookingStatus.CONFIRMED]: [HotelBookingStatus.CANCELLED, HotelBookingStatus.COMPLETED],
  [HotelBookingStatus.CANCELLED]: [],
  [HotelBookingStatus.COMPLETED]: [],
  [HotelBookingStatus.EXPIRED]: [],
};

export function canTransition(from: HotelBookingStatus, to: HotelBookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: HotelBookingStatus, to: HotelBookingStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(`A reservation in status ${from} cannot become ${to}.`);
  }
}
