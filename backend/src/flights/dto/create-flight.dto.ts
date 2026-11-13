
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsMongoId,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CabinDetailsDto } from './cabin-details.dto';

export class CreateFlightDto {
  @ApiProperty()
  @IsMongoId()
  airlineId: string;

  @ApiProperty({ example: 'MS123' })
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,10}$/)
  flightNumber: string;

  @ApiProperty({ example: 'CAI' })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  departureAirport: string;

  @ApiProperty({ example: 'DXB' })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  arrivalAirport: string;

  @ApiProperty({
    example: '2026-12-01T10:00:00',
    description:
      'Local departure date and time at the departure airport',
  })
  @IsString()
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
  )
  departureLocalTime: string;

  @ApiProperty({
    example: '2026-12-01T14:00:00',
    description:
      'Local arrival date and time at the arrival airport',
  })
  @IsString()
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
  )
  arrivalLocalTime: string;

  @ApiProperty({ type: [CabinDetailsDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique(
    (cabin: CabinDetailsDto) => cabin.cabinClass,
  )
  @ValidateNested({ each: true })
  @Type(() => CabinDetailsDto)
  cabins: CabinDetailsDto[];
}
