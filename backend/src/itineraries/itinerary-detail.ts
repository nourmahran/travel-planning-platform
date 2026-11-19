import { toItinerarySummary, type ItinerarySummary } from './itinerary-summary';
import type {
  Activity,
  ActivityImage,
  BudgetEntry,
  Day,
  TransportCost,
} from './schemas/itinerary.schema';

type Identified = { _id: unknown };

export type ImageResponse = {
  id: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type ActivityResponse = {
  id: string;
  title: string;
  attractionId?: string;
  startTime?: string;
  durationMinutes?: number;
  notes?: string;
  cost?: number;
  images: ImageResponse[];
};

export type BudgetResponse = {
  id: string;
  category: string;
  /** Currency the amount is in; defaults to the itinerary currency (ITN-14). */
  currency: string;
  amount: number;
  note?: string;
  bookingType?: 'flight' | 'hotel';
  bookingId?: string;
};

export type TransportCostResponse = {
  id: string;
  mode: string;
  fromCityId: string;
  toCityId: string;
  /** Currency the amount is in; defaults to the itinerary currency (ITN-16). */
  currency: string;
  amount: number;
  date?: string;
  note?: string;
};

export type DayResponse = {
  id: string;
  dayNumber: number;
  date: string;
  cityId: string;
  notes?: string;
  activities: ActivityResponse[];
  budgets: BudgetResponse[];
};

export type ItineraryDetail = ItinerarySummary & {
  days: DayResponse[];
  transportCosts: TransportCostResponse[];
  clonedFrom?: {
    itineraryId: string;
    authorId: string;
    authorName: string;
    clonedAt: Date;
  };
  createdAt: Date | null;
};

export function toImageResponse(
  image: ActivityImage & Identified,
): ImageResponse {
  return {
    id: String(image._id),
    url: image.url,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
  };
}

export function toActivityResponse(
  activity: Activity & Identified,
): ActivityResponse {
  return {
    id: String(activity._id),
    title: activity.title,
    attractionId: activity.attractionId,
    startTime: activity.startTime,
    durationMinutes: activity.durationMinutes,
    notes: activity.notes,
    cost: activity.cost,
    images: (activity.images ?? []).map((image) =>
      toImageResponse(image as ActivityImage & Identified),
    ),
  };
}

export function toBudgetResponse(
  budget: BudgetEntry & Identified,
  defaultCurrency: string,
): BudgetResponse {
  return {
    id: String(budget._id),
    category: budget.category,
    currency: budget.currency?.trim().toUpperCase() ?? defaultCurrency,
    amount: budget.amount,
    note: budget.note,
    bookingType: budget.bookingType,
    bookingId: budget.bookingId?.toString(),
  };
}

export function toTransportCostResponse(
  cost: TransportCost & Identified,
  defaultCurrency: string,
): TransportCostResponse {
  return {
    id: String(cost._id),
    mode: cost.mode,
    fromCityId: cost.fromCityId,
    toCityId: cost.toCityId,
    currency: cost.currency?.trim().toUpperCase() ?? defaultCurrency,
    amount: cost.amount,
    date: cost.date,
    note: cost.note,
  };
}

export function toDayResponse(
  day: Day & Identified,
  defaultCurrency: string,
): DayResponse {
  return {
    id: String(day._id),
    dayNumber: day.dayNumber,
    date: day.date,
    cityId: day.cityId,
    notes: day.notes,
    activities: (day.activities ?? []).map((activity) =>
      toActivityResponse(activity as Activity & Identified),
    ),
    budgets: (day.budgets ?? []).map((budget) =>
      toBudgetResponse(budget as BudgetEntry & Identified, defaultCurrency),
    ),
  };
}

type DetailInput = Parameters<typeof toItinerarySummary>[0] & {
  days: Day[];
  transportCosts: TransportCost[];
  clonedFrom?: {
    itineraryId: unknown;
    authorId: unknown;
    authorName: string;
    clonedAt: Date;
  };
  createdAt?: Date;
};

/** The owner-facing detail: everything on the itinerary, unlike the list summary. */
export function toItineraryDetail(itinerary: DetailInput): ItineraryDetail {
  return {
    ...toItinerarySummary(itinerary),
    days: (itinerary.days ?? []).map((day) =>
      toDayResponse(day as Day & Identified, itinerary.currency),
    ),
    transportCosts: (itinerary.transportCosts ?? []).map((cost) =>
      toTransportCostResponse(
        cost as TransportCost & Identified,
        itinerary.currency,
      ),
    ),
    clonedFrom: itinerary.clonedFrom
      ? {
          itineraryId: String(itinerary.clonedFrom.itineraryId),
          authorId: String(itinerary.clonedFrom.authorId),
          authorName: itinerary.clonedFrom.authorName,
          clonedAt: itinerary.clonedFrom.clonedAt,
        }
      : undefined,
    createdAt: itinerary.createdAt ?? null,
  };
}
