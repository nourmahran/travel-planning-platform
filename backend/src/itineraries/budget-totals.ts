import { BUDGET_CATEGORIES, type BudgetCategory } from './itinerary.constants';
import type { Day } from './schemas/itinerary.schema';
import type { EntryFactors } from './entry-currency';

export type CategoryTotals = Record<BudgetCategory, number>;

export function emptyCategoryTotals(): CategoryTotals {
  return { food: 0, accommodation: 0, local_transport: 0, activities: 0 };
}

export function addCategories(
  target: CategoryTotals,
  addition: CategoryTotals,
): CategoryTotals {
  for (const category of BUDGET_CATEGORIES) {
    target[category] += addition[category];
  }

  return target;
}

export function sumCategories(totals: CategoryTotals): number {
  return BUDGET_CATEGORIES.reduce(
    (sum, category) => sum + totals[category],
    0,
  );
}

/**
 * A day's totals per category, expressed in the itinerary currency. Activity
 * costs are added to 'activities', so a day can show a cost even when no budget
 * entry was recorded (ITN-14). `factors` converts an entry's own currency into
 * the itinerary currency (ITN-16).
 */
export function dayCategoryTotals(
  day: Pick<Day, 'budgets' | 'activities'>,
  factors: EntryFactors = () => 1,
): CategoryTotals {
  const totals = emptyCategoryTotals();

  for (const budget of day.budgets ?? []) {
    totals[budget.category] += budget.amount * factors(budget.currency);
  }

  for (const activity of day.activities ?? []) {
    totals.activities += activity.cost ?? 0;
  }

  return totals;
}
