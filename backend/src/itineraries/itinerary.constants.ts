export const ITINERARY_LIMITS = {
  titleMaxLength: 100,
  activityTitleMaxLength: 120,
  noteMaxLength: 200,
  maxDays: 60,
  maxActivitiesPerDay: 20,
  maxImagesPerActivity: 5,
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

export const ITINERARY_VISIBILITIES = ['private', 'public'] as const;

export type ItineraryVisibility = (typeof ITINERARY_VISIBILITIES)[number];

export const DEFAULT_VISIBILITY: ItineraryVisibility = 'private';

export const GEN_05_PAGE_SIZE = ITINERARY_LIMITS.defaultLimit;
