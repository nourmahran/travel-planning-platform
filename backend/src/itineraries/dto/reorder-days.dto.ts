
import {
  ArrayNotEmpty,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderDaysDto {
  @ApiProperty({
    example: ['6614f1c2a1b2c3d4e5f60718', '6614f1c2a1b2c3d4e5f60719'],
    description:
      'Every day id of the itinerary, in the wanted order. A partial list, a duplicate or a foreign id is rejected.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Matches(/^[0-9a-fA-F]{24}$/, {
    each: true,
    message: 'each dayId must be a 24-character hex id',
  })
  dayIds: string[];
}
