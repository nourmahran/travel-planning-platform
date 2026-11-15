
import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../common/auth/current-user-id.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { DaysService } from './days.service';
import { AddDayDto } from './dto/add-day.dto';
import { UpdateDayDto } from './dto/update-day.dto';
import { ReorderDaysDto } from './dto/reorder-days.dto';

@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Controller('itineraries/:itineraryId/days')
export class DaysController {
  constructor(private readonly days: DaysService) {}

  @Post()
  @ApiOperation({
    summary: 'Add a day',
    description:
      'ITN-05. Appends the day at the end, numbers it and derives its date from the start date. 400 past 60 days, unknown city, or a city outside the itinerary countries.',
  })
  add(
    @CurrentUserId() ownerId: string,
    @Param('itineraryId', ParseObjectIdPipe) itineraryId: string,
    @Body() dto: AddDayDto,
  ) {
    return this.days.add(ownerId, itineraryId, dto.cityId);
  }

  @Patch('reorder')
  @ApiOperation({
    summary: 'Reorder the days',
    description:
      'ITN-08. Body lists every day id in the wanted order; numbers and dates are recalculated.',
  })
  reorder(
    @CurrentUserId() ownerId: string,
    @Param('itineraryId', ParseObjectIdPipe) itineraryId: string,
    @Body() dto: ReorderDaysDto,
  ) {
    return this.days.reorder(ownerId, itineraryId, dto.dayIds);
  }

  @Patch(':dayId')
  @ApiOperation({
    summary: 'Change the city or the note of a day',
    description:
      'ITN-05. Send cityId, notes or both: the city must belong to the itinerary countries, and the note is at most 200 characters (an empty string clears it).',
  })
  update(
    @CurrentUserId() ownerId: string,
    @Param('itineraryId', ParseObjectIdPipe) itineraryId: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: UpdateDayDto,
  ) {
    return this.days.update(ownerId, itineraryId, dayId, {
      cityId: dto.cityId,
      notes: dto.notes,
    });
  }

  @Delete(':dayId')
  @ApiOperation({
    summary: 'Delete a day',
    description:
      'ITN-07. The remaining days are renumbered and their dates recalculated.',
  })
  remove(
    @CurrentUserId() ownerId: string,
    @Param('itineraryId', ParseObjectIdPipe) itineraryId: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
  ) {
    return this.days.remove(ownerId, itineraryId, dayId);
  }
}
