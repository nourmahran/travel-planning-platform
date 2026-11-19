import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { ITINERARY_LIMITS } from '../itinerary.constants';

export class CloneItineraryDto {
  @ApiPropertyOptional({
    example: 'Copy of Cairo and Luxor',
    description: 'Defaults to "Copy of <source title>".',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, ITINERARY_LIMITS.titleMaxLength)
  title?: string;

  @ApiPropertyOptional({
    example: '2027-03-01',
    description:
      'YYYY-MM-DD. Without it the copy keeps the source dates; with it every day date is recalculated from the new start.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be YYYY-MM-DD',
  })
  startDate?: string;
}
