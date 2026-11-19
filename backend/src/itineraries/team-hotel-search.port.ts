import { Injectable } from '@nestjs/common';
import { SearchHotelsQueryDto } from '../hotels/dto/hotel.dto';
import { HotelsService } from '../hotels/hotels.service';
import type {
  HotelSearchPort,
  HotelSearchQuery,
  HotelSearchResult,
} from './hotel-search.port';

@Injectable()
export class TeamHotelSearchPort implements HotelSearchPort {
  constructor(private readonly hotels: HotelsService) {}

  async search(query: HotelSearchQuery): Promise<HotelSearchResult> {
    const input = new SearchHotelsQueryDto();
    input.city = query.cityName;
    input.checkIn = query.checkIn;
    input.checkOut = query.checkOut;
    input.guests = query.guests;
    input.rooms = query.rooms;
    const result = await this.hotels.search(input);
    return {
      hotels: result.items.map((item) => ({
        id: item.id,
        name: item.name,
        location: item.location,
        starRating: item.starRating,
        averageRating: item.averageRating,
        currency: item.currency,
        pricePerNightCents: item.pricePerNightCents,
        totalPriceCents: item.totalPriceCents,
        selectedRooms: item.selectedRooms,
      })),
      reason: result.items.length
        ? undefined
        : 'No hotels found for these dates',
    };
  }
}
