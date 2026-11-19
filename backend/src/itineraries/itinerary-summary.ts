
import type { ItineraryDocument } from './schemas/itinerary.schema';

export type ItinerarySummary = {
  id: string;
  title: string;
  countries: string[];
  startDate: string;
  currency: string;
  visibility: string;
  isHidden: boolean;
  cloneCount: number;
  dayCount: number;
  updatedAt: Date | null;
};

export function toItinerarySummary(
  itinerary: Pick<
    ItineraryDocument,
    | '_id'
    | 'title'
    | 'countries'
    | 'startDate'
    | 'currency'
    | 'visibility'
    | 'isHidden'
    | 'cloneCount'
    | 'days'
  > & { updatedAt?: Date },
): ItinerarySummary {
  return {
    id: itinerary._id.toString(),
    title: itinerary.title,
    countries: itinerary.countries,
    startDate: itinerary.startDate,
    currency: itinerary.currency,
    visibility: itinerary.visibility,
    isHidden: itinerary.isHidden,
    cloneCount: itinerary.cloneCount,
    dayCount: itinerary.days?.length ?? 0,
    updatedAt: itinerary.updatedAt ?? null,
  };
}
