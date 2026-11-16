import { BadRequestException } from '@nestjs/common';

export interface GuestLike {
  age?: number | null;
}

export interface GuestSplit {
  adults: number;
  children: number;
}

export interface RoomOccupancyRule {
  maxAdults: number;
  maxChildren: number;
}

/** A guest without an age is an adult; under 18 counts as a child. */
export function splitGuests(guests: GuestLike[]): GuestSplit {
  let adults = 0;
  let children = 0;
  for (const guest of guests) {
    if (guest.age === undefined || guest.age === null || guest.age >= 18) {
      adults += 1;
    } else {
      children += 1;
    }
  }
  return { adults, children };
}

export function assertGuestsFitRoom(
  guests: GuestLike[],
  rule: RoomOccupancyRule,
  roomLabel: string,
  childrenAllowed: boolean,
): GuestSplit {
  if (!guests || guests.length === 0) {
    throw new BadRequestException(`Room ${roomLabel} needs at least one guest.`);
  }

  const split = splitGuests(guests);
  if (split.adults < 1) {
    throw new BadRequestException(`Room ${roomLabel} needs at least one adult guest.`);
  }
  if (split.adults > rule.maxAdults) {
    throw new BadRequestException(
      `Room ${roomLabel} allows at most ${rule.maxAdults} adult(s); ${split.adults} were provided.`,
    );
  }
  if (split.children > rule.maxChildren) {
    throw new BadRequestException(
      `Room ${rule.maxChildren === 0 ? 'does not allow children' : `allows at most ${rule.maxChildren} child(ren)`}; ${split.children} were provided for room ${roomLabel}.`,
    );
  }
  if (split.children > 0 && !childrenAllowed) {
    throw new BadRequestException('This hotel does not accept children in its rooms.');
  }
  return split;
}
