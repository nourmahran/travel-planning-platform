import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../../common/booking';

/**
 * PAY-01. Note there is NO amount field: the amount always comes from the
 * booking in the database, never from the client.
 */
export class CreatePaymentDto {
  @ApiProperty({ enum: BookingType, example: BookingType.Flight })
  @IsEnum(BookingType, { message: 'bookingType must be "flight" or "hotel"' })
  bookingType: BookingType;

  @ApiProperty({ example: '6730f1c2a4b5c6d7e8f90123' })
  @IsMongoId({ message: 'bookingId must be a valid id' })
  bookingId: string;
}

export class IdParamDto {
  @ApiProperty({ example: '6730f1c2a4b5c6d7e8f90456' })
  @IsMongoId({ message: 'id must be a valid id' })
  id: string;
}
