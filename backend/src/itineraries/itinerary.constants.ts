export const ITINERARY_LIMITS = {
  titleMaxLength: 100,
  activityTitleMaxLength: 120,
  noteMaxLength: 200,
  maxDays: 60,
  maxActivitiesPerDay: 20,
  maxImagesPerActivity: 5,
  /** GEN-08: an uploaded image may not exceed 5 MB. */
  maxImageBytes: 5 * 1024 * 1024,
  defaultPage: 1,
  defaultLimit: 10,
  maxLimit: 100,
  maxAmountDecimals: 2,
} as const;

export const BUDGET_CATEGORIES = [
  'food',
  'accommodation',
  'local_transport',
  'activities',
] as const;

export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

/** GEN-08: only JPG and PNG are accepted. */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const TRIP_TYPES = ['one-way', 'round-trip'] as const;

export type TripType = (typeof TRIP_TYPES)[number];

export const ITINERARY_VISIBILITIES = ['private', 'public'] as const;

export type ItineraryVisibility = (typeof ITINERARY_VISIBILITIES)[number];

export const DEFAULT_VISIBILITY: ItineraryVisibility = 'private';

export const GEN_05_PAGE_SIZE = ITINERARY_LIMITS.defaultLimit;
