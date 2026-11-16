
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
  StreamableFile,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../common/auth/current-user-id.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItinerariesService } from './itineraries.service';
import { BudgetSummaryService } from './budget-summary.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { BudgetSummaryQueryDto } from './dto/budget-summary-query.dto';
import { CloneItineraryDto } from './dto/clone-itinerary.dto';
import { ListItinerariesDto, UpdateItineraryDto } from './dto/update-itinerary.dto';
import { toItineraryDetail } from './itinerary-detail';
import { toItinerarySummary } from './itinerary-summary';
import { itineraryPdf } from './itinerary-pdf';

@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Controller('itineraries')
export class ItinerariesController {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly budgetSummary: BudgetSummaryService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create an itinerary',
    description:
      'ITN-01. Validates the title, the countries against the reference collection, the start date (today or later, UTC) and the currency. New itineraries are private.',
  })
  async create(
    @CurrentUserId() ownerId: string,
    @Body() dto: CreateItineraryDto,
  ) {
    return toItineraryDetail(await this.itineraries.create(ownerId, dto));
  }

  @Get()
  @ApiOperation({
    summary: 'List my itineraries',
    description:
      'ITN-03. Only the caller itineraries, newest update first, page size 10.',
  })
  async list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListItinerariesDto,
  ) {
    return this.itineraries.list(ownerId, query);
  }

  @Get(':id/budget-summary')
  @ApiOperation({
    summary: 'Budget summary of one itinerary',
    description:
      'ITN-14, ITN-18. Totals per category, per day, per city group and for the whole itinerary, in the display currency: ?currency, else the user preferredCurrency, else the itinerary currency. Day categories include activity costs under activities; transport costs are a separate list and an extra grand-total line. Every figure is converted once from its source total and rounded to 2 decimals; rateSource is live, cached, stale or same.',
  })
  async budgetSummaryOf(
    @CurrentUserId() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: BudgetSummaryQueryDto,
  ) {
    return this.budgetSummary.summary(ownerId, id, query.currency);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'ITN-28 Download an itinerary as PDF' })
  async pdf(
    @CurrentUserId() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<StreamableFile> {
    const detail = toItineraryDetail(await this.itineraries.findOne(ownerId, id));
    return new StreamableFile(await itineraryPdf(detail), {
      type: 'application/pdf',
      disposition: `attachment; filename="itinerary-${id}.pdf"`,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one itinerary',
    description:
      'ITN-03. Full detail: days with their activities and budget entries, transport costs and clone attribution. 404 when unknown, 403 when another user owns it.',
  })
  async findOne(
    @CurrentUserId() ownerId: string,
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
    @CurrentUserId() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateItineraryDto,
  ) {
    return toItinerarySummary(await this.itineraries.update(ownerId, id, dto));
  }

  @Post(':id/clone')
  @ApiOperation({
    summary: 'Clone an itinerary',
    description:
      'ITN-21, ITN-22. Copies a public itinerary, or one you own, into a new private itinerary with new subdocument ids. Keeps the source dates unless startDate is given, when every day date is recalculated. Records clonedFrom with the original author and increments the source cloneCount.',
  })
  async clone(
    @CurrentUserId() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CloneItineraryDto,
  ) {
    return toItineraryDetail(await this.itineraries.clone(ownerId, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an itinerary', description: 'ITN-01.' })
  async remove(
    @CurrentUserId() ownerId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    await this.itineraries.remove(ownerId, id);
  }
}
