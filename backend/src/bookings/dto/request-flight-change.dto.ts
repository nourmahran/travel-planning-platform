import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional } from 'class-validator';
import type { ChangeLeg } from '../flight-change.service';

export class RequestFlightChangeDto {
  @ApiProperty({ description: 'New scheduled flight on the same route and cabin' })
  @IsMongoId()
  flightId!: string;

  @ApiPropertyOptional({ enum: ['outbound', 'return'], default: 'outbound' })
  @IsOptional()
  @IsIn(['outbound', 'return'])
  leg?: ChangeLeg;
}
