import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../../common/booking';
import type { ProviderPolicies } from '../../payments/gateway/booking-gateway.interface';

/** Route params `:type/:id` shared by the booking-scoped endpoints. */
export class BookingRefParamsDto {
  @ApiProperty({ enum: BookingType, example: BookingType.Flight })
  @IsEnum(BookingType, { message: 'type must be "flight" or "hotel"' })
  type: BookingType;

  @ApiProperty({ example: '6730f1c2a4b5c6d7e8f90123' })
  @IsMongoId({ message: 'id must be a valid booking id' })
  id: string;
}

export class AcceptPoliciesDto {
  @ApiProperty({
    example: true,
    description: 'Acceptance checkbox. Must be true.',
  })
  @IsBoolean()
  accepted: boolean;
}

const FLIGHT_POLICIES_EXAMPLE = {
  kind: 'flight',
  cancellationTiers: [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 0, refundPercent: 0 },
  ],
  baggage: {
    freeBagsPerPassenger: 1,
    maxWeightKgPerBag: 23,
    extraBagPrice: 50,
    maxExtraBagsPerPassenger: 2,
  },
};

export class PoliciesResponseDto {
  @ApiProperty({ enum: BookingType, example: BookingType.Flight })
  bookingType: BookingType;

  @ApiProperty({ example: '6730f1c2a4b5c6d7e8f90123' })
  bookingId: string;

  @ApiProperty({
    type: Object,
    description:
      'Airline: cancellation tiers + baggage policy. Hotel: cancellation tiers + checkInTime/checkOutTime ("HH:mm"). If already accepted, this is the snapshot the user agreed to.',
    example: FLIGHT_POLICIES_EXAMPLE,
  })
  policies: ProviderPolicies;

  @ApiProperty({ example: false })
  accepted: boolean;

  @ApiProperty({ type: Date, nullable: true, example: null })
  acceptedAt: Date | null;
}

export class AcceptPoliciesResponseDto {
  @ApiProperty({ example: true })
  accepted: true;

  @ApiProperty({ type: Date, example: '2026-11-08T10:00:00.000Z' })
  acceptedAt: Date;

  @ApiProperty({ type: Object, example: FLIGHT_POLICIES_EXAMPLE })
  policies: ProviderPolicies;
}
