import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_ROOM_IMAGES } from '../../shared/constants';
import { IsIsoDate } from '../../shared/validation/is-iso-date.decorator';
import { BED_TYPES, type BedType } from '../schemas/room.schema';
import { HotelImageDto } from './hotel.dto';

const ROOM_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/;

export class CreateRoomDto {
  @Matches(ROOM_NUMBER_PATTERN, {
    message: 'roomNumber may contain letters, digits and dashes (max 20 characters).',
  })
  roomNumber: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(BED_TYPES)
  bedType: BedType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  bedCount: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxAdults: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  maxChildren: number;

  /** HTL-04: nightly price in minor units (cents) of the platform currency. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_00)
  basePricePerNightCents: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  sizeSqm?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  amenities?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ROOM_IMAGES)
  @ValidateNested({ each: true })
  @Type(() => HotelImageDto)
  images?: HotelImageDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-5)
  @Max(200)
  floor?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateRoomDto extends PartialType(CreateRoomDto) {}

/** HTL-04: block a room for an inclusive date range. */
export class BlockRoomDatesDto {
  @IsIsoDate()
  startDate: string;

  @IsIsoDate()
  endDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** HTL-05/HTL-06: edit an existing blocked range. */
export class UpdateRoomBlockDto {
  @IsOptional()
  @IsIsoDate()
  startDate?: string;

  @IsOptional()
  @IsIsoDate()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class AvailableRoomsQueryDto {
  @IsIsoDate()
  checkIn: string;

  @IsIsoDate()
  checkOut: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  guests?: number;
}

export class HotelAvailabilityQueryDto {
  @IsOptional()
  @IsIsoDate()
  from?: string;

  @IsOptional()
  @IsIsoDate()
  to?: string;

  @IsOptional()
  @IsMongoId()
  roomId?: string;
}

/** Not exported as a request DTO; used by the controller for route params. */
export class HotelRoomParamsDto {
  @IsMongoId()
  hotelId: string;

  @IsMongoId()
  roomId: string;
}

export class AvailabilityBlockParamsDto extends HotelRoomParamsDto {
  @IsMongoId()
  availabilityId: string;
}

/** Guest count filter used by the availability calendar. */
export class CalendarGuestFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  guests?: number;
}

export const AVAILABILITY_FILTER_TRANSFORM = Transform(({ value }) => value);
