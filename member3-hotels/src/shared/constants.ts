/**
 * Values shared by the hotels module.
 *
 * Anything that the rest of the team can change (currency, hold duration) is
 * read from the environment inside the services instead of being frozen here.
 */
export const USER_ROLES = ['USER', 'HOTEL_MODERATOR', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** GEN-05: paginated lists use a page size of 10 by default. */
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

/** Hotel stays longer than this are rejected (keeps availability queries bounded). */
export const MAX_STAY_NIGHTS = 30;

/** Maximum window returned by the availability calendar endpoint. */
export const MAX_CALENDAR_DAYS = 92;

/** GEN-08 (hotel part): image quantity limits. Member 6 owns the shared media service. */
export const MAX_HOTEL_IMAGES = 10;
export const MAX_ROOM_IMAGES = 6;

/** Multi-room reservations are capped so a single request cannot lock the whole hotel. */
export const MAX_ROOMS_PER_BOOKING = 5;
export const MAX_GUESTS_PER_ROOM = 8;
export const MAX_GUESTS_PER_BOOKING = 16;

/** Cancellation policy tiers (HTL-10). */
export const MAX_CANCELLATION_TIERS = 6;

/** A moderator may block a room for at most one year in a single range. */
export const MAX_BLOCK_DAYS = 365;

/** Fallback only; Member 4 enforces the single platform currency (PAY-18). */
export const FALLBACK_CURRENCY = 'USD';

/** HTL-16: inventory holds last 10 minutes. */
export const DEFAULT_HOLD_MINUTES = 10;

/** Reference prefix for hotel reservations, e.g. HB-7K2M4Q. */
export const BOOKING_REFERENCE_PREFIX = 'HB';
