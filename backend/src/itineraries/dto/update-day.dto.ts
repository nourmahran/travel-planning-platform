import { IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { ITINERARY_LIMITS } from '../itinerary.constants';

export class UpdateDayDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description: 'City id from the reference cities collection (ITN-05).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  cityId?: string;

  @ApiPropertyOptional({
    example: 'Old town in the morning.',
    maxLength: ITINERARY_LIMITS.noteMaxLength,
    description:
      'Free-text note for the day (ITN-05). An empty string clears it.',
  })
  @IsOptional()
  @IsString()
  @Length(0, ITINERARY_LIMITS.noteMaxLength)
  notes?: string;
}
