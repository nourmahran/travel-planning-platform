import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AccountStatus } from '../../auth/constants/account-status';
import { UserRole } from '../../auth/constants/roles';

export class ListAccountsDto {
  @ApiPropertyOptional({ example: 'roba', description: 'Search name or email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({
    example: '2026-01-01',
    description: 'Registration date from (inclusive)',
  })
  @IsOptional()
  @IsDateString()
  registeredFrom?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Registration date to (inclusive)',
  })
  @IsOptional()
  @IsDateString()
  registeredTo?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number = 10;
}
