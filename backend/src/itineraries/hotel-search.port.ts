/**
 * Contract with Member 3's hotel search (ITN-25). The port is defined here so
 * itinerary stays can use the shared hotel's live availability search.
 */
export const HOTEL_SEARCH_PORT = Symbol('HOTEL_SEARCH_PORT');

export type HotelSearchQuery = {
  cityId: string;
  cityName: string;
  /** Calendar date, YYYY-MM-DD. */
  checkIn: string;
  /** Calendar date, YYYY-MM-DD: the morning after the last stayed day. */
  checkOut: string;
  guests: number;
  rooms: number;
};

/** A hotel record as Member 3 defines it; only id and name are relied on. */
export type HotelOption = {
  id?: string;
  name?: string;
  [key: string]: unknown;
};

export type HotelSearchResult = {
  hotels: HotelOption[];
  /** Why the list is empty, when the provider knows. */
  reason?: string;
};

export interface HotelSearchPort {
  search(query: HotelSearchQuery): Promise<HotelSearchResult>;
}

/** Fallback for isolated itinerary tests without the hotel module. */
export class UnavailableHotelSearchPort implements HotelSearchPort {
  async search(): Promise<HotelSearchResult> {
    return {
      hotels: [],
      reason: 'No hotel provider is connected yet',
    };
  }
}
