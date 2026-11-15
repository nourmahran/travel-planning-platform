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
import { TransportCostsService } from './transport-costs.service';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto';
import { UpdateTransportCostDto } from './dto/update-transport-cost.dto';

@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Controller()
export class TransportCostsController {
  constructor(private readonly transportCosts: TransportCostsService) {}

  @Post('itineraries/:itineraryId/transport-costs')
  @ApiOperation({
    summary: 'Add a transport cost between two cities',
    description:
      'ITN-16. Needs a mode, two cities the itinerary days use and that differ, and a non-negative amount with at most 2 decimals. The currency is the itinerary currency.',
  })
  create(
    @CurrentUserId() ownerId: string,
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
    @CurrentUserId() ownerId: string,
    @Param('costId', ParseObjectIdPipe) costId: string,
    @Body() dto: UpdateTransportCostDto,
  ) {
    return this.transportCosts.update(ownerId, costId, dto);
  }

  @Delete('transport-costs/:costId')
  @ApiOperation({ summary: 'Delete a transport cost', description: 'ITN-16.' })
  remove(
    @CurrentUserId() ownerId: string,
    @Param('costId', ParseObjectIdPipe) costId: string,
  ) {
    return this.transportCosts.remove(ownerId, costId);
  }
}
