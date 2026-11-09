
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateAirlineDto {
  @ApiProperty({ example: 'MS', description: 'Unique airline code' })
  @IsString()
  @Matches(/^[A-Z0-9]{2,3}$/, {
    message: 'Airline code must be 2 or 3 uppercase letters or digits',
  })
  code: string;

  @ApiProperty({ example: 'EgyptAir' })
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({ example: 'EG' })
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'Country code must contain exactly 2 uppercase letters',
  })
  countryCode: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: 'https://example.com/egyptair.png',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;
}
