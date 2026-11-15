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
      'ITN-25. One stay per consecutive city group: checkIn is the first day in the city, checkOut the morning after the last. Pass the guest count and the number of rooms; both are sent to the hotel search for every stay. Hotels come from the hotel search port; until that module exists the response is available=false with a reason, never a fabricated hotel.',
  })
  hotelsOf(
    @CurrentUserId() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: HotelStayQueryDto,
  ) {
    return this.hotels.forItinerary(ownerId, id, {
      guests: query.guests,
      rooms: query.rooms,
    });
  }

  @Get('itineraries/:id/flights')
  @ApiOperation({
    summary: 'Flight search for an itinerary',
    description:
      'ITN-26. With ?originAirport, it searches from that airport to any airport of the first day city, one-way or round-trip (?tripType, default round-trip). The outbound date is the itinerary start date and the return date defaults to the last day. Without originAirport it lists one leg per change of city, dated on the arrival day. Returns the cheapest cabins (cabinClass, price per passenger, totalPrice); an empty result is available=false with a reason.',
  })
  flightsOf(
    @CurrentUserId() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ItineraryFlightsQueryDto,
  ) {
    return this.flights.forItinerary(ownerId, id, {
      passengers: query.passengers,
      limit: query.limit,
      originAirport: query.originAirport,
      tripType: query.tripType,
      returnDate: query.returnDate,
    });
  }
}
