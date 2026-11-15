import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../common/auth/current-user-id.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItineraryHotelsService } from './itinerary-hotels.service';
import { ItineraryFlightsService } from './itinerary-flights.service';
import { HotelStayQueryDto } from './dto/hotel-stay-query.dto';
import { ItineraryFlightsQueryDto } from './dto/itinerary-flights-query.dto';

@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Controller()
export class ItineraryTravelController {
  constructor(
    private readonly hotels: ItineraryHotelsService,
    private readonly flights: ItineraryFlightsService,
  ) {}

  @Get('itineraries/:id/hotels')
  @ApiOperation({
    summary: 'Hotel stays for every city of an itinerary',
    description:
      'ITN-25. One stay per consecutive city group: checkIn is the first day in the city, checkOut the morning after the last. Hotels come from the hotel search port; until that module exists the response is available=false with a reason, never a fabricated hotel.',
  })
  hotelsOf(
    @CurrentUserId() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: HotelStayQueryDto,
  ) {
    return this.hotels.forItinerary(ownerId, id, query.guests ?? 1);
  }

  @Get('itineraries/:id/flights')
  @ApiOperation({
    summary: 'Flight options between the cities of an itinerary',
    description:
      'ITN-26. One leg per change of city, dated on the arrival day, resolved through the airports of each city. Returns the cheapest cabins per leg (cabinClass, price per passenger, totalPrice). A city without an airport, or a leg with no matching flight, comes back available=false with a reason.',
  })
  flightsOf(
    @CurrentUserId() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ItineraryFlightsQueryDto,
  ) {
    return this.flights.forItinerary(ownerId, id, {
      passengers: query.passengers,
      limit: query.limit,
    });
  }
}
