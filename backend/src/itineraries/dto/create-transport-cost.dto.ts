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

import { ITINERARY_LIMITS } from '../itinerary.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTransportCostDto {
  @ApiProperty({
    example: 'cairo',
    description: 'City id; must be one of the cities used by the itinerary days.',
  })
  @IsString()
  @Length(1, 80)
  fromCityId: string;

  @ApiProperty({ example: 'luxor' })
  @IsString()
  @Length(1, 80)
  toCityId: string;

  @ApiProperty({
    example: 300,
    minimum: 0,
    description: 'Amount in the itinerary currency, at most 2 decimals.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiPropertyOptional({
    example: '2026-11-21',
    description: 'YYYY-MM-DD; the travel date of the leg.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be YYYY-MM-DD',
  })
  date?: string;

  @ApiPropertyOptional({ example: 'First-class train', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, ITINERARY_LIMITS.noteMaxLength)
  note?: string;
}
