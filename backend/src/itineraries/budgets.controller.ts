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
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Controller()
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Post('itineraries/:itineraryId/days/:dayId/budgets')
  @ApiOperation({
    summary: 'Add a daily budget entry',
    description:
      'ITN-14. Category one of food, accommodation, local_transport, activities; amount non-negative with at most 2 decimals; note up to 200 characters.',
  })
  create(
    @CurrentUserId() ownerId: string,
    @Param('itineraryId', ParseObjectIdPipe) itineraryId: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: CreateBudgetDto,
  ) {
    return this.budgets.create(ownerId, itineraryId, dayId, dto);
  }

  @Patch('budgets/:budgetId')
  @ApiOperation({
    summary: 'Edit a budget entry',
    description:
      'ITN-14. Any subset of category, amount and note; ownership is checked on the parent itinerary.',
  })
  update(
    @CurrentUserId() ownerId: string,
    @Param('budgetId', ParseObjectIdPipe) budgetId: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgets.update(ownerId, budgetId, dto);
  }

  @Delete('budgets/:budgetId')
  @ApiOperation({
    summary: 'Delete a budget entry',
    description: 'ITN-14, GEN-03.',
  })
  remove(
    @CurrentUserId() ownerId: string,
    @Param('budgetId', ParseObjectIdPipe) budgetId: string,
  ) {
    return this.budgets.remove(ownerId, budgetId);
  }
}
