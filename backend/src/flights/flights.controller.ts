import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  ForbiddenException,
  BadRequestException,
  Header,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { FlightsService } from './flights.service';
import { CreateFlightDto } from './dto/create-flight.dto';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { PatchCabinDto, UpdateFlightDto } from './dto/update-flight.dto';
import { CabinDetailsDto } from './dto/cabin-details.dto';
import { CabinClass } from './schemas/flight.schema';
import { BookingsService } from '../bookings/bookings.service';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/constants/roles';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ProviderFlightCancellationService } from './provider-flight-cancellation.service';

@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flightsService: FlightsService,
    private readonly providerCancellation: ProviderFlightCancellationService,
    private readonly bookingsService: BookingsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Create a new flight',
  })
  create(@Body() dto: CreateFlightDto, @CurrentUser() user: AuthenticatedUser) {
    if (
      user.role === UserRole.AIRLINE_MODERATOR &&
      dto.airlineId !== user.providerId
    )
      throw new ForbiddenException('Flight belongs to another airline');
    return this.flightsService.create(dto);
  }

  @Public()
  @Get('search')
  @ApiOperation({
    summary: 'FLT-11, FLT-12, FLT-15 Search one-way or round-trip flights',
    description:
      'Omit returnDate for a one-way paginated response. Supply returnDate for separate outbound and inbound paginated results. page/limit control outbound; returnPage/returnLimit control inbound.',
  })
  search(@Query() query: SearchFlightsDto) {
    return this.flightsService.searchFlights(query);
  }

  @Public()
  @Get()
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Search available one-way or round-trip flights',
    description:
      'Omit returnDate for the existing paginated response. Supply returnDate for separate outbound and inbound paginated results. page/limit control outbound; returnPage/returnLimit control inbound.',
  })
  searchFlights(@Query() query: SearchFlightsDto) {
    return this.flightsService.searchFlights(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get flight details by ID',
  })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.flightsService.details(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Update flight details and cabin pricing',
  })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateFlightDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (user.role === UserRole.AIRLINE_MODERATOR) {
      const { flight } = await this.flightsService.details(id);
      if (flight.airlineId.toString() !== user.providerId)
        throw new ForbiddenException('Flight belongs to another airline');
    }
    return this.flightsService.update(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.AIRLINE_MODERATOR)
  @ApiOperation({
    summary:
      'FLT-06 Cancel a flight, cancel its bookings and request full refunds',
  })
  cancelFlight(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cancel(id, user);
  }

  @Patch(':id/cancel')
  @ApiExcludeEndpoint()
  @Roles(UserRole.ADMIN, UserRole.AIRLINE_MODERATOR)
  async cancel(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { flight } = await this.flightsService.details(id);
    const airlineId = flight.airlineId.toString();
    if (
      user.role === UserRole.AIRLINE_MODERATOR &&
      airlineId !== user.providerId
    )
      throw new ForbiddenException('Flight belongs to another airline');
    return this.providerCancellation.cancelForAirline(id, airlineId);
  }

  @Post(':id/cabins')
  @Roles(UserRole.ADMIN, UserRole.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'FLT-04 Add a cabin class with its price, seats and baggage rules',
  })
  async addCabin(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CabinDetailsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertOwnFlight(id, user);
    return this.flightsService.addCabin(id, dto);
  }

  @Patch(':id/cabins/:cabinId')
  @Roles(UserRole.ADMIN, UserRole.AIRLINE_MODERATOR)
  @ApiParam({
    name: 'cabinId',
    enum: CabinClass,
    description: 'Cabin class name',
  })
  @ApiOperation({
    summary: 'FLT-04, FLT-05 Update one cabin (price, seat count, baggage)',
    description:
      'Seat-count changes must be sent on their own and cannot drop below seats already booked.',
  })
  async updateCabin(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('cabinId') cabinId: string,
    @Body() dto: PatchCabinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!Object.values(CabinClass).includes(cabinId as CabinClass))
      throw new BadRequestException(
        `cabinId must be one of: ${Object.values(CabinClass).join(', ')}`,
      );
    await this.assertOwnFlight(id, user);
    return this.flightsService.update(id, {
      cabins: [{ ...dto, cabinClass: cabinId as CabinClass }],
    });
  }

  @Get(':id/bookings')
  @Roles(UserRole.AIRLINE_MODERATOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'FLT-29 List bookings and passengers on a flight' })
  async bookings(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const airlineId = await this.assertOwnFlight(id, user);
    return this.bookingsService.listForAirline(
      id,
      airlineId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
    );
  }

  @Get(':id/passengers/export')
  @Roles(UserRole.AIRLINE_MODERATOR, UserRole.ADMIN)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'FLT-29 Export the flight passenger list as CSV' })
  async exportPassengers(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<string> {
    const airlineId = await this.assertOwnFlight(id, user);
    let csv = '';
    for await (const chunk of this.bookingsService.exportPassengers(
      id,
      airlineId,
    ))
      csv += chunk;
    return csv;
  }

  /** Moderators may only touch their own airline's flights; returns its airline id. */
  private async assertOwnFlight(
    id: string,
    user: AuthenticatedUser,
  ): Promise<string> {
    const { flight } = await this.flightsService.details(id);
    const airlineId = flight.airlineId.toString();
    if (
      user.role === UserRole.AIRLINE_MODERATOR &&
      airlineId !== user.providerId
    )
      throw new ForbiddenException('Flight belongs to another airline');
    return airlineId;
  }
}
