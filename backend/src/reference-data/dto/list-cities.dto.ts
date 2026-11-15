
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { ITINERARY_LIMITS } from '../../itineraries/itinerary.constants';

export class ListCitiesDto {
  @ApiPropertyOptional({ example: 'EG', description: 'ISO country code.' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Za-z]{2}$/, { message: 'country must be a 2-letter code' })
  country?: string;

  @ApiPropertyOptional({ example: 'cai', description: 'Name search.' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

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
