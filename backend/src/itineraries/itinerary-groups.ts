import { buildCityGroups, type CityGroup, type CityReference } from './city-groups';
import { dayList } from './subdocuments';
import type { Day } from './schemas/itinerary.schema';
import type { ReferenceDataService } from '../reference-data/reference-data.service';

/** Consecutive city stays of an itinerary, named from reference data. */
export async function cityGroupsOf(
  itinerary: { countries: string[]; days: Day[] },
  referenceData: ReferenceDataService,
): Promise<CityGroup[]> {
  const cities = new Map<string, CityReference>(
    (await referenceData.citiesInCountries(itinerary.countries)).map(
      (city) => [
        city.city_id,
        { name: city.name, countryCode: city.country_code },
      ],
    ),
  );

  return buildCityGroups(dayList(itinerary), cities);
}
