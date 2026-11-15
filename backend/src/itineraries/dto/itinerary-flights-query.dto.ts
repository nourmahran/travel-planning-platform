import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ItineraryFlightsQueryDto {
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    maximum: 20,
    default: 1,
    description:
      'Passengers per leg; a cabin must have that many seats left to be offered.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  passengers?: number;

  @ApiPropertyOptional({
    example: 3,
    minimum: 1,
    maximum: 10,
    default: 3,
    description: 'Cheapest options returned per leg.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
