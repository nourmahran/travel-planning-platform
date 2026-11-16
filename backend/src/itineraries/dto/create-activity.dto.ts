import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ITINERARY_LIMITS } from '../itinerary.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateActivityDto {
  @ApiProperty({ example: 'Pyramids of Giza', minLength: 1, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, ITINERARY_LIMITS.activityTitleMaxLength)
  title: string;

  @ApiPropertyOptional({
    example: 'Cairo',
    description: 'Optional attraction reference.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  attractionId?: string;

  @ApiPropertyOptional({
    example: '09:00',
    description: 'HH:mm in 24-hour time.',
  })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ example: 180, minimum: 1, maximum: 1440 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;

  @ApiPropertyOptional({
    example: 'Tickets bought online.',
    maxLength: ITINERARY_LIMITS.noteMaxLength,
  })
  @IsOptional()
  @IsString()
  @Length(0, ITINERARY_LIMITS.noteMaxLength)
  notes?: string;

  @ApiPropertyOptional({
    example: 450,
    minimum: 0,
    description: 'Amount in the itinerary currency, at most 2 decimals.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;
}
