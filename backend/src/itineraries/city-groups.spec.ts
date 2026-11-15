import { buildCityGroups } from './city-groups';

type Day = { dayNumber: number; date: string; cityId: string };

const day = (dayNumber: number, cityId: string): Day => ({
  dayNumber,
  date: `2026-11-${String(dayNumber).padStart(2, '0')}`,
  cityId,
});

const cities = new Map([
  ['cairo', { name: 'Cairo', countryCode: 'EG' }],
  ['luxor', { name: 'Luxor', countryCode: 'EG' }],
  ['paris', { name: 'Paris', countryCode: 'FR' }],
]);

describe('buildCityGroups', () => {
  it('returns one group for a single city', () => {
    expect(buildCityGroups([day(1, 'cairo'), day(2, 'cairo')], cities)).toEqual([
      {
        cityId: 'cairo',
        cityName: 'Cairo',
        countryCode: 'EG',
        fromDay: 1,
        toDay: 2,
        dateFrom: '2026-11-01',
        dateTo: '2026-11-02',
        days: [1, 2],
      },
    ]);
  });

  it('splits alternating cities into daily groups', () => {
    const groups = buildCityGroups(
      [day(1, 'cairo'), day(2, 'paris'), day(3, 'cairo')],
      cities,
    );

    expect(groups.map((group) => group.cityId)).toEqual([
      'cairo',
      'paris',
      'cairo',
    ]);
    expect(groups.map((group) => group.days)).toEqual([[1], [2], [3]]);
  });

  it('merges consecutive days of the same city and keeps later runs apart', () => {
    const groups = buildCityGroups(
      [
        day(1, 'cairo'),
        day(2, 'cairo'),
        day(3, 'luxor'),
        day(4, 'cairo'),
      ],
      cities,
    );

    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ cityId: 'cairo', fromDay: 1, toDay: 2 });
    expect(groups[1]).toMatchObject({ cityId: 'luxor', fromDay: 3, toDay: 3 });
    expect(groups[2]).toMatchObject({ cityId: 'cairo', fromDay: 4, toDay: 4 });
  });

  it('returns nothing for an empty itinerary', () => {
    expect(buildCityGroups([], cities)).toEqual([]);
  });

  it('falls back to the city id when the reference city is unknown', () => {
    const groups = buildCityGroups([day(1, 'atlantis')], cities);

    expect(groups[0]).toMatchObject({
      cityId: 'atlantis',
      cityName: 'atlantis',
      countryCode: '',
    });
  });
});
