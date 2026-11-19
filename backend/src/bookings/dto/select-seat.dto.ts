import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export type SeatLeg = 'outbound' | 'return';

/** FLT-28: choose or change one passenger's numbered seat. */
export class SelectSeatDto {
  @ApiProperty({
    minimum: 0,
    description: 'Position of the passenger in the booking (0 = first)',
  })
  @IsInt()
  @Min(0)
  passengerIndex!: number;

  @ApiProperty({ minimum: 1, example: 12 })
  @IsInt()
  @Min(1)
  seatNumber!: number;

  @ApiPropertyOptional({ enum: ['outbound', 'return'], default: 'outbound' })
  @IsOptional()
  @IsIn(['outbound', 'return'])
  leg?: SeatLeg;
}
