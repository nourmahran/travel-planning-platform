import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsBoolean,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Roba Tarek', minLength: 2 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '+201001234567' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s-]{7,20}$/, {
    message: 'Phone must be a valid phone number',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: 'USD',
    description: 'ISO 4217 currency code',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'Preferred currency must be a 3-letter code',
  })
  preferredCurrency?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'GEN-01-B: receive email copies of in-app notifications',
  })
  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;
}
