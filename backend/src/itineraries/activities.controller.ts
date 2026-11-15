import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/auth/current-user.decorator';
import { DevUserGuard } from '../common/auth/dev-user.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ActivitiesService } from './activities.service';
import { AddImageDto } from './dto/add-image.dto';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';

@ApiTags('Itineraries')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-dev-user-id',
  required: true,
  description:
    'Temporary development auth: any 24-hex ObjectId. Requires ENABLE_DEV_AUTH=true.',
})
@UseGuards(DevUserGuard)
@Controller()
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Post('itineraries/:itineraryId/days/:dayId/activities')
  @ApiOperation({
    summary: 'Add an activity to a day',
    description:
      'ITN-10. Title 1-120, optional HH:mm start time, optional 1-1440 minute duration, optional non-negative cost with at most 2 decimals. At most 20 activities per day.',
  })
  create(
    @CurrentUser() ownerId: string,
    @Param('itineraryId', ParseObjectIdPipe) itineraryId: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activities.create(ownerId, itineraryId, dayId, dto);
  }

  @Patch('activities/:activityId')
  @ApiOperation({
    summary: 'Edit an activity',
    description:
      'ITN-10. Any subset of the activity fields; the parent itinerary and day are found from the activity id and ownership is checked on the parent.',
  })
  update(
    @CurrentUser() ownerId: string,
    @Param('activityId', ParseObjectIdPipe) activityId: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activities.update(ownerId, activityId, dto);
  }

  @Delete('activities/:activityId')
  @ApiOperation({
    summary: 'Delete an activity',
    description: 'ITN-10, GEN-03. Removes the activity from its day.',
  })
  remove(
    @CurrentUser() ownerId: string,
    @Param('activityId', ParseObjectIdPipe) activityId: string,
  ) {
    return this.activities.remove(ownerId, activityId);
  }

  @Post('activities/:activityId/images')
  @ApiOperation({
    summary: 'Attach an image to an activity',
    description:
      'ITN-12, GEN-08. URL body until the media service exists. At most 5 images per activity; Member 6 owns the final cap.',
  })
  addImage(
    @CurrentUser() ownerId: string,
    @Param('activityId', ParseObjectIdPipe) activityId: string,
    @Body() dto: AddImageDto,
  ) {
    return this.activities.addImage(ownerId, activityId, dto);
  }

  @Delete('activities/:activityId/images/:imageId')
  @ApiOperation({
    summary: 'Remove an activity image',
    description: 'ITN-12. 404 when the image does not belong to the activity.',
  })
  removeImage(
    @CurrentUser() ownerId: string,
    @Param('activityId', ParseObjectIdPipe) activityId: string,
    @Param('imageId', ParseObjectIdPipe) imageId: string,
  ) {
    return this.activities.removeImage(ownerId, activityId, imageId);
  }
}
