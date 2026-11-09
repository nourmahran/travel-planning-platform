
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  Min,
} from 'class-validator';
import { CabinClass } from '../schemas/flight.schema';

export class CabinDetailsDto {
  @ApiProperty({ enum: CabinClass })
  @IsEnum(CabinClass)
  cabinClass: CabinClass;

  @ApiProperty({ example: 2500 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(0)
  totalSeats: number;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(0)
  availableSeats: number;

  @ApiProperty({ example: 23 })
  @IsNumber()
  @Min(0)
  baggageAllowanceKg: number;

  @ApiProperty({ example: 15 })
  @IsNumber()
  @Min(0)
  extraBaggagePricePerKg: number;
}
