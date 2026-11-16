import {
  toActivityResponse,
  toBudgetResponse,
  type ActivityResponse,
  type BudgetResponse,
} from './itinerary-detail';
import {
  addCategories,
  dayCategoryTotals,
  emptyCategoryTotals,
  sumCategories,
  type CategoryTotals,
} from './budget-totals';
import { roundAmount } from '../common/utils/round-amount';
import { identityFactors, type EntryFactors } from './entry-currency';
import type { CityReference } from './city-groups';
import type { BudgetEntry, Day, TransportCost } from './schemas/itinerary.schema';

export type PublicAuthor = {
  id: string;
  name: string;
};

export type PublicDay = {
  dayNumber: number;
  date: string;
  city: { id: string; name: string; countryCode: string } | null;
  activities: ActivityResponse[];
  budgets: BudgetResponse[];
};

/** ITN-21: the budget is shown in the itinerary currency, without any conversion. */
export type PublicBudget = {
  currency: string;
  categories: CategoryTotals;
  transport: number;
  grandTotal: number;
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
  budget: PublicBudget;
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
    transportCosts?: TransportCost[];
  },
  author: PublicAuthor,
  originalAuthor: PublicAuthor | undefined,
  cities: Map<string, CityReference>,
  factors: EntryFactors = identityFactors(),
): PublicItineraryDetail {
  const days = itinerary.days ?? [];
  const totals = days.reduce(
    (categories, day) =>
      addCategories(categories, dayCategoryTotals(day, factors)),
    emptyCategoryTotals(),
  );
  const categories: CategoryTotals = {
    food: roundAmount(totals.food),
    accommodation: roundAmount(totals.accommodation),
    local_transport: roundAmount(totals.local_transport),
    activities: roundAmount(totals.activities),
  };
  const transport = roundAmount(
    (itinerary.transportCosts ?? []).reduce(
      (sum, cost) => sum + cost.amount * factors(cost.currency),
      0,
    ),
  );

  return {
    id: String(itinerary._id),
    title: itinerary.title,
    countries: itinerary.countries,
    startDate: itinerary.startDate,
    currency: itinerary.currency,
    cloneCount: itinerary.cloneCount,
    updatedAt: itinerary.updatedAt ?? null,
    days: days.map((day) => {
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
        budgets: (day.budgets ?? []).map((budget) => {
          const response = toBudgetResponse(
            budget as BudgetEntry & Identified,
            itinerary.currency,
          );
          delete response.bookingId;
          return response;
        }),
      };
    }),
    budget: {
      currency: itinerary.currency,
      categories,
      transport,
      grandTotal: roundAmount(sumCategories(categories) + transport),
    },
    author,
    originalAuthor,
  };
}
