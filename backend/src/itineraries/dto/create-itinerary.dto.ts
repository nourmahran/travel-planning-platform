
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ITINERARY_LIMITS } from '../itinerary.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateItineraryDto {
  @ApiProperty({ example: 'Cairo and Luxor', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, ITINERARY_LIMITS.titleMaxLength)
  title: string;

  @ApiProperty({
    example: ['EG'],
    description: 'Country codes from the countries collection.',
    minItems: 1,
    maxItems: 10,
  })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((code) => (typeof code === 'string' ? code.trim().toUpperCase() : code))
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[A-Za-z]{2}$/, {
    each: true,
    message: 'each country must be a 2-letter code',
  })
  countries: string[];

  @ApiProperty({ example: '2026-12-01', description: 'YYYY-MM-DD.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be YYYY-MM-DD',
  })
  startDate: string;

  @ApiPropertyOptional({
    example: 'EGP',
    description: 'Defaults to the first country currency.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;
}
