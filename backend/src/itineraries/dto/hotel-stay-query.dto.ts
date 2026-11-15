import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class HotelStayQueryDto {
  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    maximum: 20,
    default: 1,
    description: 'Guests per room request for every city stay.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  guests?: number;
}
