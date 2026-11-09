
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import {
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { FlightsService } from './flights.service';
import { CreateFlightDto } from './dto/create-flight.dto';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';

@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flightsService: FlightsService,
  ) {}

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
    description: 'Omit returnDate for the existing paginated response. Supply returnDate for separate outbound and inbound paginated results. page/limit control outbound; returnPage/returnLimit control inbound.',
  })
  searchFlights(
    @Query() query: SearchFlightsDto,
  ) {
    return this.flightsService.searchFlights(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get flight details by ID',
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.flightsService.findOne(id);
  }
}
