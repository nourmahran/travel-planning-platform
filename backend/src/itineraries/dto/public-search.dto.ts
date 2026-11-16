import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { ITINERARY_LIMITS } from '../itinerary.constants';

export const PUBLIC_SORT_OPTIONS = ['newest', 'popular'] as const;
export type PublicSort = (typeof PUBLIC_SORT_OPTIONS)[number];

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class PublicSearchDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description: 'Case-insensitive title search.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ example: 'EG', description: 'ISO country code.' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country?: string;

  @ApiPropertyOptional({
    example: 'cairo',
    description: 'City id that at least one day visits.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  city?: string;

  @ApiPropertyOptional({ example: '6614f1c2a1b2c3d4e5f60718' })
  @IsOptional()
  @Matches(/^[0-9a-fA-F]{24}$/, {
    message: 'authorId must be a 24-character hex id',
  })
  authorId?: string;

  @ApiPropertyOptional({ example: 2, minimum: 0, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ITINERARY_LIMITS.maxDays)
  minDays?: number;

  @ApiPropertyOptional({ example: 10, minimum: 0, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ITINERARY_LIMITS.maxDays)
  maxDays?: number;

  @ApiPropertyOptional({
    enum: PUBLIC_SORT_OPTIONS,
    default: 'newest',
    description: 'newest = last updated; popular = most cloned.',
  })
  @IsOptional()
  @IsIn(PUBLIC_SORT_OPTIONS)
  sort?: PublicSort;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: ITINERARY_LIMITS.defaultLimit,
    minimum: 1,
    maximum: ITINERARY_LIMITS.maxLimit,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ITINERARY_LIMITS.maxLimit)
  limit?: number;
}
