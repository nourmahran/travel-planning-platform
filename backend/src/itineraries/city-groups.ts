
export type CityReference = {
  name: string;
  countryCode: string;
};

export type GroupableDay = {
  dayNumber: number;
  date: string;
  cityId: string;
};

export type CityGroup = {
  cityId: string;
  cityName: string;
  countryCode: string;
  fromDay: number;
  toDay: number;
  dateFrom: string;
  dateTo: string;
  days: number[];
};

/**
 * Consecutive runs of the same city, computed on read and never stored
 * (ITN-09). Days are expected in itinerary order.
 */
export function buildCityGroups(
  days: GroupableDay[],
  cities: Map<string, CityReference>,
): CityGroup[] {
  const groups: CityGroup[] = [];

  for (const day of days) {
    const current = groups[groups.length - 1];

    if (current && current.cityId === day.cityId) {
      current.toDay = day.dayNumber;
      current.dateTo = day.date;
      current.days.push(day.dayNumber);

      continue;
    }

    const city = cities.get(day.cityId);

    groups.push({
      cityId: day.cityId,
      cityName: city?.name ?? day.cityId,
      countryCode: city?.countryCode ?? '',
      fromDay: day.dayNumber,
      toDay: day.dayNumber,
      dateFrom: day.date,
      dateTo: day.date,
      days: [day.dayNumber],
    });
  }

  return groups;
}
