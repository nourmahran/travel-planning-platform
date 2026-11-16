import {
  addCategories,
  dayCategoryTotals,
  emptyCategoryTotals,
  sumCategories,
} from './budget-totals';

describe('budget-totals', () => {
  it('sums budget entries per category', () => {
    const totals = dayCategoryTotals({
      budgets: [
        { category: 'food', amount: 100 },
        { category: 'food', amount: 50 },
        { category: 'accommodation', amount: 300 },
      ],
      activities: [],
    });

    expect(totals).toEqual({
      food: 150,
      accommodation: 300,
      local_transport: 0,
      activities: 0,
    });
  });

  it('adds activity costs to the activities category', () => {
    const totals = dayCategoryTotals({
      budgets: [{ category: 'activities', amount: 20 }],
      activities: [{ cost: 30 }, { cost: 50 }, {}],
    });

    expect(totals.activities).toBe(100);
  });

  it('ignores missing arrays', () => {
    expect(dayCategoryTotals({})).toEqual(emptyCategoryTotals());
  });

  it('adds category maps and sums them', () => {
    const total = addCategories(
      { ...emptyCategoryTotals(), food: 10 },
      { ...emptyCategoryTotals(), food: 5, activities: 7 },
    );

    expect(total.food).toBe(15);
    expect(sumCategories(total)).toBe(22);
  });
});
