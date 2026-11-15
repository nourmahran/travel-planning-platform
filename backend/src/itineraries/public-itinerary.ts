import { toActivityResponse, type ActivityResponse } from './itinerary-detail';
import type { CityReference } from './city-groups';
import type { Day } from './schemas/itinerary.schema';

export type PublicAuthor = {
  id: string;
  name: string;
};

export type PublicDay = {
  dayNumber: number;
  date: string;
  city: { id: string; name: string; countryCode: string } | null;
  activities: ActivityResponse[];
};

export type PublicItineraryDetail = {
  id: string;
  title: string;
  countries: string[];
  startDate: string;
  currency: string;
  cloneCount: number;
  updatedAt: Date | null;
  days: PublicDay[];
  author: PublicAuthor;
  originalAuthor?: PublicAuthor;
};

type Identified = { _id: unknown };

export function toPublicDetail(
  itinerary: {
    _id: unknown;
    title: string;
    countries: string[];
    startDate: string;
    currency: string;
    cloneCount: number;
    updatedAt?: Date;
    days: Day[];
  },
  author: PublicAuthor,
  originalAuthor: PublicAuthor | undefined,
  cities: Map<string, CityReference>,
): PublicItineraryDetail {
  return {
    id: String(itinerary._id),
    title: itinerary.title,
    countries: itinerary.countries,
    startDate: itinerary.startDate,
    currency: itinerary.currency,
    cloneCount: itinerary.cloneCount,
    updatedAt: itinerary.updatedAt ?? null,
    days: (itinerary.days ?? []).map((day) => {
      const city = cities.get(day.cityId);

      return {
        dayNumber: day.dayNumber,
        date: day.date,
        city: city
          ? { id: day.cityId, name: city.name, countryCode: city.countryCode }
          : null,
        activities: (day.activities ?? []).map((activity) =>
          toActivityResponse(activity as typeof activity & Identified),
        ),
      };
    }),
    author,
    originalAuthor,
  };
}
