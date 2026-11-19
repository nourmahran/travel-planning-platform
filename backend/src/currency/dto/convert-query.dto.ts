import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class ConvertQueryDto {
  @ApiProperty({ example: 100, minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'EGP', minLength: 3, maxLength: 3 })
  @Transform(upper)
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'from must be a 3-letter currency code' })
  from: string;

  @ApiProperty({ example: 'EUR', minLength: 3, maxLength: 3 })
  @Transform(upper)
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'to must be a 3-letter currency code' })
  to: string;
}
