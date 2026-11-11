import { IsNumber } from 'class-validator';

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CabinClass } from '../schemas/flight.schema';

export class SearchFlightsDto {
  @ApiPropertyOptional({
    minimum: 0,
    description: 'Minimum per-seat cabin fare.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Maximum per-seat cabin fare.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    enum: [
      'departure',
      'price_asc',
      'price_desc',
      'duration_asc',
      'duration_desc',
    ],
    description: 'Price ordering uses the cheapest eligible cabin.',
  })
  @IsOptional()
  @IsEnum({
    departure: 'departure',
    price_asc: 'price_asc',
    price_desc: 'price_desc',
    duration_asc: 'duration_asc',
    duration_desc: 'duration_desc',
  })
  sortBy?:
    'departure' | 'price_asc' | 'price_desc' | 'duration_asc' | 'duration_desc';

  @ApiPropertyOptional({ example: 'CAI' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  departureAirport?: string;

  @ApiPropertyOptional({ example: 'DXB' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  arrivalAirport?: string;

  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  departureDate?: string;

  @ApiPropertyOptional({
    example: '2026-12-08',
    description:
      'Enables round-trip search. Local departure date at the return airport.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  returnDate?: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description: 'Return results page (default 1).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  returnPage?: number;

  @ApiPropertyOptional({
    example: 10,
    minimum: 1,
    maximum: 100,
    description: 'Return page size (defaults to limit).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  returnLimit?: number;

  @ApiPropertyOptional({ enum: CabinClass })
  @IsOptional()
  @IsEnum(CabinClass)
  cabinClass?: CabinClass;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  passengers?: number;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
