import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_GUESTS_PER_ROOM, MAX_ROOMS_PER_BOOKING } from '../../shared/constants';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';
import { IsIsoDate } from '../../shared/validation/is-iso-date.decorator';
import { HotelBookingStatus } from '../schemas/hotel-booking.schema';

export class GuestInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName: string;

  /** Members under 18 count towards the room's children limit. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number;
}

export class RoomSelectionDto {
  @IsMongoId()
  roomId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_GUESTS_PER_ROOM)
  @ValidateNested({ each: true })
  @Type(() => GuestInputDto)
  guests: GuestInputDto[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  specialRequests?: string;
}

/** HTL-16 + HTL-18: create a 10-minute reservation hold for one or more rooms. */
export class CreateHotelBookingDto {
  @IsMongoId()
  hotelId: string;

  @IsIsoDate()
  checkIn: string;

  @IsIsoDate()
  checkOut: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROOMS_PER_BOOKING)
  @ValidateNested({ each: true })
  @Type(() => RoomSelectionDto)
  rooms: RoomSelectionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CancelHotelBookingDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason?: string;
}

export class ListMyBookingsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(HotelBookingStatus)
  status?: HotelBookingStatus;

  /** Inclusive lower bound on the check-in date. */
  @IsOptional()
  @IsIsoDate()
  from?: string;

  /** Inclusive upper bound on the check-out date. */
  @IsOptional()
  @IsIsoDate()
  to?: string;
}

/** HTL-22: hotel moderator reservation list. */
export class HotelReservationsQueryDto extends ListMyBookingsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  guestName?: string;
}

/** Used by Member 1's administrator booking inspection (ACC-17). */
export class AdminBookingsQueryDto extends ListMyBookingsQueryDto {
  @IsOptional()
  @IsMongoId()
  hotelId?: string;

  @IsOptional()
  @IsMongoId()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  reference?: string;
}

/** Called by Member 4 after Stripe verified the payment. */
export class ConfirmHotelBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentId?: string;
}

/** Called by Member 4 when it creates the PaymentIntent for a held booking. */
export class AttachPaymentIntentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  paymentIntentId: string;
}

export const REFUND_STATUS_VALUES = ['PENDING', 'REFUNDED', 'FAILED'] as const;
export type RefundStatusValue = (typeof REFUND_STATUS_VALUES)[number];

/** Called by Member 4's webhook/refund reconciliation. */
export class UpdateRefundStatusDto {
  @IsIn([...REFUND_STATUS_VALUES])
  status: RefundStatusValue;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerRefundId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  failureReason?: string;
}
