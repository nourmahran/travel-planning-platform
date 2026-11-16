import { BadRequestException } from '@nestjs/common';
import { assertNonNegativeInteger } from '../../shared/utils/money.util';

export interface PricedRoom {
  pricePerNightCents: number;
  nights: number;
}

/** One room line: nightly price × occupied nights. */
export function calculateRoomSubtotal(pricePerNightCents: number, nights: number): number {
  assertNonNegativeInteger(pricePerNightCents, 'pricePerNightCents');
  if (!Number.isInteger(nights) || nights < 1) {
    throw new BadRequestException('nights must be a positive integer.');
  }
  return pricePerNightCents * nights;
}

/** Reservation total (HTL-17). No taxes or fees are invented here: Member 4
 *  owns payment amounts, and the reservation total is the sum of room lines. */
export function calculateReservationTotal(rooms: PricedRoom[]): number {
  return rooms.reduce((total, room) => total + calculateRoomSubtotal(room.pricePerNightCents, room.nights), 0);
}
