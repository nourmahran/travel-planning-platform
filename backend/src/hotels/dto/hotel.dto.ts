import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_CANCELLATION_TIERS, MAX_HOTEL_IMAGES } from '../../shared/constants';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';
import { IsIsoDate } from '../../shared/validation/is-iso-date.decorator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class HotelImageDto {
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { message: 'Each image needs a valid http(s) URL.' })
  @MaxLength(2048)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  caption?: string;
}

export class HotelLocationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  city: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  country: string;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  address: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;
}

/** HTL-10: one cancellation tier. The 0-day tier is mandatory. */
export class CancellationTierDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  minDaysBeforeCheckIn: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  refundPercent: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

/** HTL-09 + HTL-10 */
export class HotelPoliciesDto {
  @Matches(TIME_PATTERN, { message: 'checkInTime must use HH:mm (24h) format.' })
  checkInTime: string;

  @Matches(TIME_PATTERN, { message: 'checkOutTime must use HH:mm (24h) format.' })
  checkOutTime: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CANCELLATION_TIERS)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  cancellationTiers: CancellationTierDto[];

  @IsOptional()
  @IsBoolean()
  childrenAllowed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateHotelDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(20)
  @MaxLength(5000)
  description: string;

  @ValidateNested()
  @Type(() => HotelLocationDto)
  location: HotelLocationDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  amenities?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HOTEL_IMAGES)
  @ValidateNested({ each: true })
  @Type(() => HotelImageDto)
  images?: HotelImageDto[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  starRating: number;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  /** ADMIN only: assign the hotel to a hotel moderator account. */
  @IsOptional()
  @IsMongoId()
  moderatorId?: string;
}

/**
 * HTL-01 profile management. `isActive` and `moderatorId` are administrator
 * fields (ACC-13/ACC-15) and are rejected for hotel moderators in the service.
 */
export class UpdateHotelDto extends PartialType(CreateHotelDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export const HOTEL_SEARCH_SORTS = [
  'price_asc',
  'price_desc',
  'rating_desc',
  'rating_asc',
  'stars_desc',
  'name_asc',
] as const;
export type HotelSearchSort = (typeof HOTEL_SEARCH_SORTS)[number];

export class SearchHotelsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @IsOptional()
  @IsIsoDate()
  checkIn?: string;

  @IsOptional()
  @IsIsoDate()
  checkOut?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  guests: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rooms: number = 1;

  /** Nightly price filter, in minor units. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  amenities?: string[];

  @IsOptional()
  @IsIn(HOTEL_SEARCH_SORTS)
  sort: HotelSearchSort = 'rating_desc';
}
