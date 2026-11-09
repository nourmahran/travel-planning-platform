
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CabinClass } from '../../flights/schemas/flight.schema';

export class BookingPassengerDto {
  @ApiProperty({ example: 'Ahmed' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Mohamed' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'A12345678' })
  @IsString()
  @IsNotEmpty()
  passportNumber: string;
}

export class CreateBookingDto {
  @ApiProperty({
    example: '6af0556c09fc7ac74c5d3f6d',
    description: 'MongoDB ID of the flight being booked',
  })
  @IsMongoId()
  flightId: string;

  @ApiProperty({
    example: 'test-user-001',
    description: 'Temporary user ID until authentication is integrated',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    enum: CabinClass,
    example: CabinClass.ECONOMY,
  })
  @IsEnum(CabinClass)
  cabinClass: CabinClass;

  @ApiProperty({
    type: [BookingPassengerDto],
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BookingPassengerDto)
  passengers: BookingPassengerDto[];
}
