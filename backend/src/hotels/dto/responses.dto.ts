import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HotelBookingStatus, RefundStatus } from '../schemas/hotel-booking.schema';

export class HotelImageResponseDto {
  @ApiProperty()
  url: string;

  @ApiPropertyOptional()
  caption?: string;
}

export class HotelLocationResponseDto {
  @ApiProperty()
  city: string;

  @ApiProperty()
  country: string;

  @ApiProperty()
  address: string;

  @ApiPropertyOptional({ nullable: true })
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true })
  longitude?: number | null;
}

export class CancellationTierResponseDto {
  @ApiProperty({ example: 7 })
  minDaysBeforeCheckIn: number;

  @ApiProperty({ example: 100 })
  refundPercent: number;

  @ApiPropertyOptional()
  description?: string;
}

export class HotelPoliciesResponseDto {
  @ApiProperty({ example: '14:00' })
  checkInTime: string;

  @ApiProperty({ example: '12:00' })
  checkOutTime: string;

  @ApiProperty({ type: [CancellationTierResponseDto] })
  cancellationTiers: CancellationTierResponseDto[];

  @ApiProperty()
  childrenAllowed: boolean;

  @ApiPropertyOptional()
  notes?: string;
}

export class RoomResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  hotelId: string;

  @ApiProperty({ example: '204' })
  roomNumber: string;

  @ApiProperty({ example: 'Deluxe Double Room' })
  name: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({ example: 'queen' })
  bedType: string;

  @ApiProperty({ example: 1 })
  bedCount: number;

  @ApiProperty({ example: 2 })
  maxAdults: number;

  @ApiProperty({ example: 1 })
  maxChildren: number;

  @ApiProperty({ example: 12000, description: 'Nightly price in minor units (cents).' })
  basePricePerNightCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiPropertyOptional({ nullable: true })
  sizeSqm?: number | null;

  @ApiProperty({ type: [String] })
  amenities: string[];

  @ApiProperty({ type: [HotelImageResponseDto] })
  images: HotelImageResponseDto[];

  @ApiPropertyOptional({ nullable: true })
  floor?: number | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: string;
}

export class AvailableRoomDto extends RoomResponseDto {
  @ApiProperty({ example: 2 })
  nights: number;

  @ApiProperty({ example: 24000, description: 'Nightly price × nights.' })
  totalPriceCents: number;
}

export class AvailableRoomsResponseDto {
  @ApiProperty()
  hotelId: string;

  @ApiProperty({ example: '2026-12-01' })
  checkIn: string;

  @ApiProperty({ example: '2026-12-03' })
  checkOut: string;

  @ApiProperty({ example: 2 })
  nights: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ type: [AvailableRoomDto] })
  rooms: AvailableRoomDto[];
}

export class HotelResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: HotelLocationResponseDto })
  location: HotelLocationResponseDto;

  @ApiProperty({ type: [String] })
  amenities: string[];

  @ApiProperty({ type: [HotelImageResponseDto] })
  images: HotelImageResponseDto[];

  @ApiProperty({ example: 4 })
  starRating: number;

  @ApiProperty({ example: 4.35 })
  averageRating: number;

  @ApiProperty({ example: 18 })
  reviewCount: number;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional({ nullable: true })
  moderatorId?: string | null;

  @ApiPropertyOptional()
  contactEmail?: string;

  @ApiPropertyOptional()
  contactPhone?: string;

  @ApiProperty({ type: HotelPoliciesResponseDto })
  policies: HotelPoliciesResponseDto;

  @ApiPropertyOptional({ type: [RoomResponseDto] })
  rooms?: RoomResponseDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: string;
}

export class SelectedRoomSummaryDto {  @ApiProperty()
  roomId: string;

  @ApiProperty()
  roomNumber: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ example: 12000 })
  pricePerNightCents: number;

  @ApiProperty({ example: 2 })
  maxAdults: number;

  @ApiProperty({ example: 1 })
  maxChildren: number;
}

export class HotelSearchItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: HotelLocationResponseDto })
  location: HotelLocationResponseDto;

  @ApiProperty({ example: 4 })
  starRating: number;

  @ApiProperty({ example: 4.35 })
  averageRating: number;

  @ApiProperty({ example: 18 })
  reviewCount: number;

  @ApiProperty({ type: [String] })
  amenities: string[];

  @ApiProperty({ type: [HotelImageResponseDto] })
  images: HotelImageResponseDto[];

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 1, description: 'Number of nights priced (1 when no dates are supplied).' })
  nights: number;

  @ApiProperty({ example: 18000, description: 'Cheapest nightly total for the requested rooms.' })
  pricePerNightCents: number;

  @ApiProperty({ example: 36000, description: 'Nightly total × nights.' })
  totalPriceCents: number;

  @ApiProperty({ type: [SelectedRoomSummaryDto] })
  selectedRooms: SelectedRoomSummaryDto[];
}

export class AvailabilityDayDto {
  @ApiProperty({ example: '2026-12-01' })
  date: string;

  @ApiProperty({ enum: ['available', 'blocked', 'held', 'booked'] })
  status: 'available' | 'blocked' | 'held' | 'booked';

  @ApiProperty({ example: 12000 })
  pricePerNightCents: number;

  @ApiPropertyOptional({
    example: 'HTL-7K2M9Q',
    description: 'HTL-08: reservation occupying the night (hotel moderators and admins only)',
  })
  reservationReference?: string;
}

export class RoomCalendarDto {
  @ApiProperty()
  roomId: string;

  @ApiProperty()
  roomNumber: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: [AvailabilityDayDto] })
  days: AvailabilityDayDto[];
}

export class HotelCalendarDto {
  @ApiProperty()
  hotelId: string;

  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;

  @ApiProperty({ type: [RoomCalendarDto] })
  rooms: RoomCalendarDto[];
}

export class RoomAvailabilityBlockResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  hotelId: string;

  @ApiProperty()
  roomId: string;

  @ApiProperty({ example: '2026-12-01' })
  startDate: string;

  @ApiProperty({ example: '2026-12-05' })
  endDate: string;

  @ApiPropertyOptional()
  reason?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;
}

export class BookingGuestResponseDto {
  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiPropertyOptional({ nullable: true })
  age?: number | null;
}

export class BookedRoomResponseDto {
  @ApiProperty()
  roomId: string;

  @ApiProperty()
  roomNumber: string;

  @ApiProperty()
  roomName: string;

  @ApiProperty({ example: 12000 })
  pricePerNightCents: number;

  @ApiProperty({ example: 2 })
  nights: number;

  @ApiProperty({ type: [BookingGuestResponseDto] })
  guests: BookingGuestResponseDto[];

  @ApiProperty({ example: 24000 })
  subtotalCents: number;

  @ApiPropertyOptional()
  specialRequests?: string;
}

export class RefundResponseDto {
  @ApiProperty({ example: 24000 })
  amountCents: number;

  @ApiProperty({ example: 100 })
  percent: number;

  @ApiProperty({ enum: RefundStatus })
  status: RefundStatus;

  @ApiPropertyOptional({ nullable: true })
  providerRefundId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  requestedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  processedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  failureReason?: string | null;
}

export class BookingCancellationResponseDto {
  @ApiProperty({ enum: ['USER', 'ADMIN', 'MODERATOR', 'SYSTEM'] })
  cancelledBy: string;

  @ApiPropertyOptional()
  reason?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  cancelledAt: string;

  @ApiProperty()
  daysBeforeCheckIn: number;

  @ApiProperty({ type: RefundResponseDto })
  refund: RefundResponseDto;
}

export class BookingPolicySnapshotResponseDto {
  @ApiProperty()
  checkInTime: string;

  @ApiProperty()
  checkOutTime: string;

  @ApiProperty({ type: [CancellationTierResponseDto] })
  cancellationTiers: CancellationTierResponseDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  capturedAt: string;
}

export class HotelBookingResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'HB-7K2M4Q' })
  reference: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  hotelId: string;

  @ApiProperty()
  hotelName: string;

  @ApiProperty({ type: [BookedRoomResponseDto] })
  rooms: BookedRoomResponseDto[];

  @ApiProperty({ example: '2026-12-01' })
  checkIn: string;

  @ApiProperty({ example: '2026-12-03' })
  checkOut: string;

  @ApiProperty({ example: 2 })
  nights: number;

  @ApiProperty({ example: 3 })
  guestCount: number;

  @ApiProperty({ example: 24000, description: 'Total in minor units (cents).' })
  totalAmountCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ enum: HotelBookingStatus })
  status: HotelBookingStatus;

  @ApiPropertyOptional({ nullable: true })
  holdExpiresAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  confirmedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  completedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  expiredAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  policiesAcceptedAt?: string | null;

  @ApiProperty({ type: BookingPolicySnapshotResponseDto })
  policySnapshot: BookingPolicySnapshotResponseDto;

  @ApiPropertyOptional({ type: BookingCancellationResponseDto, nullable: true })
  cancellation?: BookingCancellationResponseDto | null;

  @ApiPropertyOptional({ nullable: true })
  paymentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  reviewId?: string | null;

  @ApiPropertyOptional()
  notes?: string;

  @ApiProperty({ description: 'True when the signed-in owner may still review this stay.' })
  canReview: boolean;

  @ApiProperty({ description: 'True while the 10-minute hold is still active.' })
  holdActive: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: string;
}

export class CancellationQuoteResponseDto {
  @ApiProperty()
  bookingId: string;

  @ApiProperty()
  daysBeforeCheckIn: number;

  @ApiProperty({ example: 50 })
  refundPercent: number;

  @ApiProperty({ example: 12000 })
  refundAmountCents: number;

  @ApiProperty({ example: 24000 })
  totalAmountCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiPropertyOptional()
  tierDescription?: string;
}

export class ReviewReplyResponseDto {
  @ApiProperty()
  body: string;

  @ApiProperty()
  repliedBy: string;

  @ApiProperty({ type: String, format: 'date-time' })
  repliedAt: string;
}

export class ReviewResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  hotelId: string;

  @ApiProperty()
  bookingId: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ example: 5 })
  rating: number;

  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Optional review text (HTL-23)' })
  comment: string | null;

  @ApiProperty()
  isHidden: boolean;

  @ApiPropertyOptional({ nullable: true })
  hiddenReason?: string | null;

  @ApiProperty()
  isDeleted: boolean;

  @ApiPropertyOptional({ type: ReviewReplyResponseDto, nullable: true })
  moderatorReply?: ReviewReplyResponseDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: string;
}
