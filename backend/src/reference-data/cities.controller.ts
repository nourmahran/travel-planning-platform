
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { ReferenceDataService } from './reference-data.service';
import { ListCitiesDto } from './dto/list-cities.dto';

@ApiTags('Cities')
@Public()
@Controller('cities')
export class CitiesController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Get()
  @ApiOperation({
    summary: 'List reference cities',
    description:
      'Read-only reference list shared with hotels and airports (ITN-05). Filters by country and name, paginated 10 by default, sorted by name.',
  })
  list(@Query() query: ListCitiesDto) {
    return this.referenceData.listCities(query);
  }
}
