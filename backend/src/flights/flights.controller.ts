import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  ForbiddenException,
} from '@nestjs/common';

import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { FlightsService } from './flights.service';
import { CreateFlightDto } from './dto/create-flight.dto';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
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
  @Get()
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

  @Patch(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Cancel a scheduled flight without allocated seats',
  })
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
}
