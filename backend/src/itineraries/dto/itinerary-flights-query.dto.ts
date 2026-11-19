import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { TRIP_TYPES } from '../itinerary.constants';
import type { TripType } from '../itinerary.constants';

export class ItineraryFlightsQueryDto {
  @ApiPropertyOptional({
    example: 'CAI',
    description:
      'ITN-26. IATA code of the chosen origin airport. When present the search flies from it to the city of the first day, one-way or round-trip; when absent the route lists the legs between the itinerary cities instead.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/, { message: 'originAirport must be a 3-letter IATA code' })
  originAirport?: string;

  @ApiPropertyOptional({
    enum: TRIP_TYPES,
    default: 'round-trip',
    description:
      'ITN-26. Round-trip searches the return leg too. Ignored without originAirport.',
  })
  @IsOptional()
  @IsIn(TRIP_TYPES)
  tripType?: TripType;

  @ApiPropertyOptional({
    example: '2026-12-08',
    description:
      'ITN-26. Return date for a round-trip; defaults to the date of the last day. Ignored without originAirport and for a one-way trip.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'returnDate must be YYYY-MM-DD',
  })
  returnDate?: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    maximum: 20,
    default: 1,
    description:
      'Passengers per leg; a cabin must have that many seats left to be offered.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  passengers?: number;

  @ApiPropertyOptional({
    example: 3,
    minimum: 1,
    maximum: 10,
    default: 3,
    description: 'Cheapest options returned per direction.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
