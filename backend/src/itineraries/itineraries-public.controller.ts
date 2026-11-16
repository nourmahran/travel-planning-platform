import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItinerariesPublicService } from './itineraries-public.service';
import { PublicSearchDto } from './dto/public-search.dto';

@ApiTags('Itineraries')
@Public()
@Controller('itineraries/public')
export class ItinerariesPublicController {
  constructor(
    private readonly publicItineraries: ItinerariesPublicService,
  ) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search public itineraries',
    description:
      'ITN-20, ITN-21. Guest access. Only visibility=public and not hidden. Filters: q (matched against the title, a country or a city), country, city (a day city), authorId, minDays, maxDays; sort newest or popular; page size 10.',
  })
  search(@Query() query: PublicSearchDto) {
    return this.publicItineraries.search(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read a public itinerary',
    description:
      'ITN-21. Guest access. Private or hidden itineraries return 404. Shows the days with their city, activities and budget entries, the budget in the itinerary currency (categories, transport and grand total), the author name, and the original author when the itinerary is a clone.',
  })
  detail(@Param('id', ParseObjectIdPipe) id: string) {
    return this.publicItineraries.detail(id);
  }
}
