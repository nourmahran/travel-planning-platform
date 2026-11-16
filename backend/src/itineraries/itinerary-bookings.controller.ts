import { Controller, Delete, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../common/auth/current-user-id.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItineraryBookingsService } from './itinerary-bookings.service';

@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Controller('itineraries/:itineraryId/days/:dayId/bookings')
export class ItineraryBookingsController {
  constructor(private readonly bookings: ItineraryBookingsService) {}

  @Post(':type/:bookingId')
  @ApiOperation({ summary: 'ITN-27 Link a confirmed flight or hotel booking to a day and budget' })
  link(
    @CurrentUserId() ownerId: string,
    @Param('itineraryId', ParseObjectIdPipe) itineraryId: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Param('type') type: string,
    @Param('bookingId', ParseObjectIdPipe) bookingId: string,
  ) { return this.bookings.link(ownerId, itineraryId, dayId, type, bookingId); }

  @Delete(':type/:bookingId')
  @ApiOperation({ summary: 'ITN-27 Unlink a booking from an itinerary day and budget' })
  unlink(
    @CurrentUserId() ownerId: string,
    @Param('itineraryId', ParseObjectIdPipe) itineraryId: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Param('type') type: string,
    @Param('bookingId', ParseObjectIdPipe) bookingId: string,
  ) { return this.bookings.unlink(ownerId, itineraryId, dayId, type, bookingId); }
}
