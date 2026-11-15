import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BUDGET_CATEGORIES } from '../itinerary.constants';
import type { BudgetCategory } from '../itinerary.constants';
import { ITINERARY_LIMITS } from '../itinerary.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const uppercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateBudgetDto {
  @ApiProperty({
    enum: BUDGET_CATEGORIES,
    example: 'food',
    description: 'One of the four budget categories.',
  })
  @IsString()
  category: BudgetCategory;

  @ApiProperty({
    example: 200,
    minimum: 0,
    description: 'Amount in the itinerary currency, at most 2 decimals.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiPropertyOptional({
    example: 'EGP',
    description:
      'Currency the amount is in; defaults to the itinerary currency (ITN-14).',
  })
  @IsOptional()
  @Transform(uppercase)
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;

  @ApiPropertyOptional({ example: 'Lunch', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, ITINERARY_LIMITS.noteMaxLength)
  note?: string;
}
