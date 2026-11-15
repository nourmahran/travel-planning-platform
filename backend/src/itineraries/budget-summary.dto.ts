import type { RateSource } from '../currency/exchange-rates.service';
import type { CategoryTotals } from './budget-totals';

export type SummaryRateSource = RateSource | 'same';

export type BudgetDaySummary = {
  dayId: string;
  dayNumber: number;
  date: string;
  cityId: string;
  categories: CategoryTotals;
  total: number;
};

export type BudgetCityGroupSummary = {
  cityId: string;
  cityName: string;
  countryCode: string;
  fromDay: number;
  toDay: number;
  dateFrom: string;
  dateTo: string;
  categories: CategoryTotals;
  total: number;
};

export type BudgetTransportSummary = {
  id: string;
  fromCityId: string;
  toCityId: string;
  date?: string;
  amount: number;
  convertedAmount: number;
};

export type BudgetTotals = {
  categories: CategoryTotals;
  transport: number;
  grandTotal: number;
};

export type BudgetSummary = {
  itineraryId: string;
  currency: string;
  sourceCurrency: string;
  rateDate: string | null;
  rateSource: SummaryRateSource;
  totals: BudgetTotals;
  byDay: BudgetDaySummary[];
  byCityGroup: BudgetCityGroupSummary[];
  transportCosts: BudgetTransportSummary[];
};
