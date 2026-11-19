
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

import { ITINERARY_LIMITS, ITINERARY_VISIBILITIES } from '../itinerary.constants';
import type { ItineraryVisibility } from '../itinerary.constants';
import { CreateItineraryDto } from './create-itinerary.dto';

export class UpdateItineraryDto extends PartialType(CreateItineraryDto) {
  @ApiPropertyOptional({
    enum: ITINERARY_VISIBILITIES,
    example: 'public',
    description: 'Public itineraries appear in the public search (ITN-20).',
  })
  @IsOptional()
  @IsIn(ITINERARY_VISIBILITIES)
  visibility?: ItineraryVisibility;
}

export class ListItinerariesDto {
  @ApiProperty({ required: false, example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({
    required: false,
    example: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ITINERARY_LIMITS.maxLimit)
  limit?: number;
}
