import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
  ArrayUnique,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CabinClass } from '../schemas/flight.schema';

export class UpdateCabinDto {
  @ApiPropertyOptional({ enum: CabinClass })
  @IsEnum(CabinClass)
  cabinClass: CabinClass;

  @ApiPropertyOptional({ example: 3000 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  price?: number;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalSeats?: number;

  @ApiPropertyOptional({ example: 23 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  baggageAllowanceKg?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  extraBaggagePricePerKg?: number;
}

/** Body for PATCH /flights/:id/cabins/:cabinId; the cabin class comes from the URL. */
export class PatchCabinDto extends OmitType(UpdateCabinDto, [
  'cabinClass',
] as const) {}

export class UpdateFlightDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  airlineId?: string;

  @ApiPropertyOptional({ example: 'MS124' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,10}$/)
  flightNumber?: string;

  @ApiPropertyOptional({ example: 'CAI' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  departureAirport?: string;

  @ApiPropertyOptional({ example: 'DXB' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  arrivalAirport?: string;

  @ApiPropertyOptional({
    example: '2026-12-01T11:00:00',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  departureLocalTime?: string;

  @ApiPropertyOptional({
    example: '2026-12-01T16:00:00',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  arrivalLocalTime?: string;

  @ApiPropertyOptional({ type: [UpdateCabinDto] })
  @IsOptional()
  @IsArray()
  @ArrayUnique((cabin: UpdateCabinDto) => cabin.cabinClass)
  @ValidateNested({ each: true })
  @Type(() => UpdateCabinDto)
  cabins?: UpdateCabinDto[];
}
