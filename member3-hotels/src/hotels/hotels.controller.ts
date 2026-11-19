import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { AuthUser } from '../shared/auth/auth-user';
import { AuthGuard, OptionalAuthGuard } from '../shared/auth/auth.guard';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Roles } from '../shared/auth/roles.decorator';
import { RolesGuard } from '../shared/auth/roles.guard';
import { ParseMongoIdPipe } from '../shared/pipes/parse-mongo-id.pipe';
import { HotelReservationsQueryDto } from './dto/booking.dto';
import {
  CreateHotelDto,
  HotelPoliciesDto,
  SearchHotelsQueryDto,
  UpdateHotelDto,
} from './dto/hotel.dto';
import { HotelAvailabilityQueryDto } from './dto/room.dto';
import {
  HotelBookingResponseDto,
  HotelCalendarDto,
  HotelPoliciesResponseDto,
  HotelResponseDto,
  HotelSearchItemDto,
} from './dto/responses.dto';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelsService } from './hotels.service';
import { RoomsService } from './rooms.service';

@ApiTags('Hotels')
@Controller('api/hotels')
export class HotelsController {
  constructor(
    private readonly hotels: HotelsService,
    private readonly bookings: HotelBookingsService,
    private readonly rooms: RoomsService,
  ) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-01 Create a hotel',
    description:
      'Hotel moderators create the single hotel they manage; administrators may also create one and assign a moderator with moderatorId.',
  })
  @ApiCreatedResponse({ type: HotelResponseDto })
  create(
    @Body() dto: CreateHotelDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelResponseDto> {
    return this.hotels.create(dto, user);
  }

  @Get('search')
  @ApiOperation({
    summary: 'HTL-11 / HTL-12 Search hotels',
    description:
      'Filters: destination city/country, stay dates, guest count, room count, nightly price, minimum rating and amenities. Sorts: price, rating, stars, name. Paginated (10 by default). Price filters use pricePerNightCents (minor units) for the cheapest suitable room combination.',
  })
  @ApiOkResponse({
    description: 'Paginated list: { items: HotelSearchItemDto[], page, limit, total, totalPages }',
  })
  search(@Query() query: SearchHotelsQueryDto) {
    return this.hotels.search(query);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiOperation({
    summary: 'HTL-02 Hotel details',
    description:
      'Returns the hotel profile, amenities, images, rating and policies. Active rooms are included; the assigned moderator also sees inactive rooms. Deactivated hotels return 404 to the public.',
  })
  @ApiOkResponse({ type: HotelResponseDto })
  findOne(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @CurrentUser() user?: AuthUser,
  ): Promise<HotelResponseDto> {
    return this.hotels.findOne(id, user);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-01 Update a hotel profile',
    description:
      'Only the assigned hotel moderator or an administrator. isActive and moderatorId are administrator-only fields (ACC-13/ACC-15).',
  })
  @ApiOkResponse({ type: HotelResponseDto })
  update(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateHotelDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelResponseDto> {
    return this.hotels.update(id, dto, user);
  }

  @Put(':id/policies')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-09 / HTL-10 Replace check-in/out rules and cancellation tiers',
    description:
      'The policy must include a 0-day cancellation tier. Tiers are stored with the reservation at booking time so later policy edits never change an existing refund.',
  })
  @ApiOkResponse({ type: HotelPoliciesResponseDto })
  replacePolicies(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Body() dto: HotelPoliciesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelPoliciesResponseDto> {
    return this.hotels.replacePolicies(id, dto, user);
  }

  @Get(':id/availability')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'HTL-08 Room availability calendar',
    description:
      'Per-room day status for available, blocked, held and booked nights. Defaults to the next 30 days; the window is capped at 92 days. Optional roomId narrows the calendar.',
  })
  @ApiOkResponse({ type: HotelCalendarDto })
  calendar(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Query() query: HotelAvailabilityQueryDto,
    @CurrentUser() user?: AuthUser,
  ): Promise<HotelCalendarDto> {
    return this.rooms.calendar(id, query, user);
  }

  @Get(':id/reservations')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-22 Hotel moderator reservation list',
    description:
      'Paginated reservations of this hotel with optional status, check-in date range, reference and guest-name filters.',
  })
  @ApiOkResponse({
    description:
      'Paginated list: { items: HotelBookingResponseDto[], page, limit, total, totalPages }',
  })
  reservations(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Query() query: HotelReservationsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookings.listForHotel(id, query, user);
  }
}
