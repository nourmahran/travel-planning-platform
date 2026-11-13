import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { FlightsService } from './flights.service';
import { CreateFlightDto } from './dto/create-flight.dto';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';

@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new flight',
  })
  create(@Body() dto: CreateFlightDto) {
    return this.flightsService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Search available one-way or round-trip flights',
    description:
      'Omit returnDate for the existing paginated response. Supply returnDate for separate outbound and inbound paginated results. page/limit control outbound; returnPage/returnLimit control inbound.',
  })
  searchFlights(@Query() query: SearchFlightsDto) {
    return this.flightsService.searchFlights(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get flight details by ID',
  })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.flightsService.details(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update flight details and cabin pricing',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateFlightDto,
  ) {
    return this.flightsService.update(id, dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a scheduled flight without allocated seats',
  })
  cancel(@Param('id', ParseObjectIdPipe) id: string) {
    return this.flightsService.cancel(id);
  }
}
