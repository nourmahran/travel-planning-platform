
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/auth/current-user.decorator';
import { DevUserGuard } from '../common/auth/dev-user.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItinerariesService } from './itineraries.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ListItinerariesDto, UpdateItineraryDto } from './dto/update-itinerary.dto';
import { toItineraryDetail } from './itinerary-detail';
import { toItinerarySummary } from './itinerary-summary';

@ApiTags('Itineraries')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-dev-user-id',
  required: true,
  description:
    'Temporary development auth: any 24-hex ObjectId. Requires ENABLE_DEV_AUTH=true.',
})
@UseGuards(DevUserGuard)
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an itinerary',
    description:
      'ITN-01. Validates the title, the countries against the reference collection, the start date (today or later, UTC) and the currency. New itineraries are private.',
  })
  async create(
    @CurrentUser() ownerId: string,
    @Body() dto: CreateItineraryDto,
  ) {
    return this.itineraries.create(ownerId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List my itineraries',
    description:
      'ITN-03. Only the caller itineraries, newest update first, page size 10.',
  })
  async list(
    @CurrentUser() ownerId: string,
    @Query() query: ListItinerariesDto,
  ) {
    return this.itineraries.list(ownerId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one itinerary',
    description:
      'ITN-03. Full detail: days with their activities and budget entries, transport costs and clone attribution. 404 when unknown, 403 when another user owns it.',
  })
  async findOne(
    @CurrentUser() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return toItineraryDetail(await this.itineraries.findOne(ownerId, id));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit an itinerary',
    description:
      'ITN-01, ITN-20. Edits title, countries, startDate, currency and visibility. Changing countries is refused when an existing day city would fall outside them.',
  })
  async update(
    @CurrentUser() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateItineraryDto,
  ) {
    return toItinerarySummary(await this.itineraries.update(ownerId, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an itinerary', description: 'ITN-01.' })
  async remove(
    @CurrentUser() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    await this.itineraries.remove(ownerId, id);
  }
}
