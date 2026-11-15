import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CancellationTierDto {
  @ApiProperty({
    minimum: 0,
    description: 'Applies when this many full days remain before departure',
  })
  @IsInt()
  @Min(0)
  daysBefore: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  refundPercent: number;
}

export class BaggagePolicyDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) freeBagsPerPassenger: number;
  @ApiProperty({ minimum: 0 }) @IsNumber() @Min(0) maxWeightKgPerBag: number;
  @ApiProperty({ minimum: 0 }) @IsNumber() @Min(0) extraBagPrice: number;
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  maxExtraBagsPerPassenger: number;
}

export class FlightPoliciesDto {
  @ApiProperty({ type: [CancellationTierDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  cancellationTiers: CancellationTierDto[];

  @ApiProperty({ type: BaggagePolicyDto })
  @ValidateNested()
  @Type(() => BaggagePolicyDto)
  baggage: BaggagePolicyDto;
}
