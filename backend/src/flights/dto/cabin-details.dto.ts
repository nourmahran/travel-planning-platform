import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { CabinClass } from '../schemas/flight.schema';

export class CabinDetailsDto {
  @ApiProperty({ enum: CabinClass })
  @IsEnum(CabinClass)
  cabinClass: CabinClass;

  @ApiProperty({ example: 2500 })
  @IsNumber()
  @Min(0.01)
  price: number;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(1)
  totalSeats: number;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(0)
  availableSeats: number;

  @ApiPropertyOptional({ example: 23, deprecated: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  baggageAllowanceKg?: number;

  @ApiPropertyOptional({ example: 15, deprecated: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  extraBaggagePricePerKg?: number;

  @ApiProperty({ example: 1, minimum: 0 })
  @IsInt()
  @Min(0)
  freeBagsPerPassenger: number;

  @ApiProperty({ example: 23, minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  maxWeightKgPerBag: number;

  @ApiProperty({ example: 50, minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  extraBagPrice: number;

  @ApiProperty({ example: 2, minimum: 0 })
  @IsInt()
  @Min(0)
  maxExtraBagsPerPassenger: number;
}
