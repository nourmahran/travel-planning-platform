import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsInt,
  Min,
  Matches,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CabinClass } from '../../flights/schemas/flight.schema';

export class BookingPassengerDto {
  @ApiProperty({ required: false, description: 'Optional numbered seat in the selected outbound cabin' })
  @IsOptional()
  @IsInt()
  @Min(1)
  seatNumber?: number;

  @ApiProperty({ required: false, description: 'Optional numbered seat in the return cabin' })
  @IsOptional()
  @IsInt()
  @Min(1)
  returnSeatNumber?: number;

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

  @ApiProperty({
    example: '1995-06-15',
    description:
      'Birth date used to determine adult, child or infant fare at departure',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth: string;

  @ApiProperty({
    type: [Number],
    required: false,
    description: 'Weight in kilograms of each extra bag',
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  extraBagWeightsKg?: number[];
}

export class CreateBookingDto {
  @ApiProperty({
    example: '6af0556c09fc7ac74c5d3f6d',
    description: 'MongoDB ID of the flight being booked',
  })
  @IsMongoId()
  flightId: string;

  @ApiProperty({
    required: false,
    description: 'Return flight for one round-trip booking and payment',
  })
  @IsOptional()
  @IsMongoId()
  returnFlightId?: string;

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

export class CreateBookingRequestDto extends OmitType(CreateBookingDto, [
  'userId',
] as const) {}
