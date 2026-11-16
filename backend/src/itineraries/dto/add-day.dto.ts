
import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddDayDto {
  @ApiProperty({
    example: 'cairo',
    description: 'City id from the reference cities collection (ITN-05).',
  })
  @IsString()
  @Length(1, 80)
  cityId: string;
}
