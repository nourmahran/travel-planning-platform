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
import { TransportCostsService } from './transport-costs.service';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto';
import { UpdateTransportCostDto } from './dto/update-transport-cost.dto';

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
export class TransportCostsController {
  constructor(private readonly transportCosts: TransportCostsService) {}

  @Post('itineraries/:itineraryId/transport-costs')
  @ApiOperation({
    summary: 'Add a transport cost between two cities',
    description:
      'ITN-16. Both cities must be used by the itinerary days and must differ; amount non-negative with at most 2 decimals.',
  })
  create(
    @CurrentUser() ownerId: string,
    @Param('itineraryId', ParseObjectIdPipe) itineraryId: string,
    @Body() dto: CreateTransportCostDto,
  ) {
    return this.transportCosts.create(ownerId, itineraryId, dto);
  }

  @Patch('transport-costs/:costId')
  @ApiOperation({
    summary: 'Edit a transport cost',
    description: 'ITN-16. Rechecked against the itinerary cities.',
  })
  update(
    @CurrentUser() ownerId: string,
    @Param('costId', ParseObjectIdPipe) costId: string,
    @Body() dto: UpdateTransportCostDto,
  ) {
    return this.transportCosts.update(ownerId, costId, dto);
  }

  @Delete('transport-costs/:costId')
  @ApiOperation({ summary: 'Delete a transport cost', description: 'ITN-16.' })
  remove(
    @CurrentUser() ownerId: string,
    @Param('costId', ParseObjectIdPipe) costId: string,
  ) {
    return this.transportCosts.remove(ownerId, costId);
  }
}
