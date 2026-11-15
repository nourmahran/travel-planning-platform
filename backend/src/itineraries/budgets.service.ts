import { BadRequestException, Injectable } from '@nestjs/common';

import {
  BUDGET_CATEGORIES,
  type BudgetCategory,
} from './itinerary.constants';
import { ItinerariesService } from './itineraries.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import {
  budgetList,
  requireBudget,
  requireDay,
  type BudgetSubdocument,
} from './subdocuments';
import { toBudgetResponse } from './itinerary-detail';
import type { BudgetEntry } from './schemas/itinerary.schema';
import { isMoney } from './validation';

@Injectable()
export class BudgetsService {
  constructor(private readonly itineraries: ItinerariesService) {}

  async create(
    ownerId: string,
    itineraryId: string,
    dayId: string,
    dto: CreateBudgetDto,
  ) {
    const itinerary = await this.itineraries.findOne(ownerId, itineraryId);
    const day = requireDay(itinerary, dayId);

    this.assertFields(dto);

    day.budgets.push({
      category: dto.category,
      amount: dto.amount,
      note: dto.note?.trim(),
    } as BudgetEntry);

    await itinerary.save();

    const budgets = budgetList(day) as unknown as BudgetSubdocument[];

    return toBudgetResponse(budgets[budgets.length - 1]);
  }

  async update(ownerId: string, budgetId: string, dto: UpdateBudgetDto) {
    const itinerary = await this.itineraries.findOneByBudget(ownerId, budgetId);
    const { budget } = requireBudget(itinerary, budgetId);

    this.assertFields(dto);

    if (dto.category !== undefined) {
      budget.category = dto.category;
    }

    if (dto.amount !== undefined) {
      budget.amount = dto.amount;
    }

    if (dto.note !== undefined) {
      budget.note = dto.note.trim();
    }

    await itinerary.save();

    return toBudgetResponse(budget);
  }

  async remove(ownerId: string, budgetId: string) {
    const itinerary = await this.itineraries.findOneByBudget(ownerId, budgetId);
    const { day, index } = requireBudget(itinerary, budgetId);

    (day.budgets as unknown as BudgetSubdocument[]).splice(index, 1);

    await itinerary.save();

    return { removedBudgetId: budgetId };
  }

  private assertFields(dto: { category?: string; amount?: number }): void {
    if (
      dto.category !== undefined &&
      !BUDGET_CATEGORIES.includes(dto.category as BudgetCategory)
    ) {
      throw new BadRequestException(
        `category must be one of ${BUDGET_CATEGORIES.join(', ')}`,
      );
    }

    if (dto.amount !== undefined && !isMoney(dto.amount)) {
      throw new BadRequestException(
        'amount must be a non-negative amount with at most 2 decimals',
      );
    }
  }
}
