import type { AuthUser } from '../../shared/auth/auth-user';
import type {
  BookingCancellationResponseDto,
  BookedRoomResponseDto,
  HotelBookingResponseDto,
  HotelCalendarDto,
  HotelImageResponseDto,
  HotelLocationResponseDto,
  HotelPoliciesResponseDto,
  HotelResponseDto,
  HotelSearchItemDto,
  ReviewResponseDto,
  RoomAvailabilityBlockResponseDto,
  RoomCalendarDto,
  RoomResponseDto,
} from '../dto/responses.dto';
import { HotelBookingStatus } from '../schemas/hotel-booking.schema';
import type { HotelBookingDocument } from '../schemas/hotel-booking.schema';
import type { HotelDocument, HotelPolicies } from '../schemas/hotel.schema';
import type { RoomAvailabilityDocument } from '../schemas/room-availability.schema';
import type { RoomDocument } from '../schemas/room.schema';
import type { ReviewDocument } from '../schemas/review.schema';

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function mapCancellationTiers(policies: HotelPolicies) {
  return policies.cancellationTiers.map((tier) => ({
    minDaysBeforeCheckIn: tier.minDaysBeforeCheckIn,
    refundPercent: tier.refundPercent,
    ...(tier.description ? { description: tier.description } : {}),
  }));
}

export function toHotelLocation(doc: HotelDocument): HotelLocationResponseDto {
  return {
    city: doc.location.city,
    country: doc.location.country,
    address: doc.location.address,
    latitude: doc.location.latitude ?? null,
    longitude: doc.location.longitude ?? null,
  };
}

export function toHotelImages(doc: HotelDocument | RoomDocument): HotelImageResponseDto[] {
  return doc.images.map((image) => ({ url: image.url, ...(image.caption ? { caption: image.caption } : {}) }));
}

export function toHotelPolicies(doc: HotelDocument): HotelPoliciesResponseDto {
  return {
    checkInTime: doc.policies.checkInTime,
    checkOutTime: doc.policies.checkOutTime,
    cancellationTiers: mapCancellationTiers(doc.policies),
    childrenAllowed: doc.policies.childrenAllowed,
    ...(doc.policies.notes ? { notes: doc.policies.notes } : {}),
  };
}

export function toRoomResponse(doc: RoomDocument): RoomResponseDto {
  return {
    id: doc._id.toString(),
    hotelId: doc.hotelId.toString(),
    roomNumber: doc.roomNumber,
    name: doc.name,
    ...(doc.description ? { description: doc.description } : {}),
    bedType: doc.bedType,
    bedCount: doc.bedCount,
    maxAdults: doc.maxAdults,
    maxChildren: doc.maxChildren,
    basePricePerNightCents: doc.basePricePerNightCents,
    currency: doc.currency,
    sizeSqm: doc.sizeSqm ?? null,
    amenities: [...doc.amenities],
    images: toHotelImages(doc),
    floor: doc.floor ?? null,
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toHotelResponse(doc: HotelDocument, rooms?: RoomDocument[]): HotelResponseDto {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description,
    location: toHotelLocation(doc),
    amenities: [...doc.amenities],
    images: toHotelImages(doc),
    starRating: doc.starRating,
    averageRating: doc.averageRating,
    reviewCount: doc.reviewCount,
    isActive: doc.isActive,
    moderatorId: doc.moderatorId ? doc.moderatorId.toString() : null,
    ...(doc.contactEmail ? { contactEmail: doc.contactEmail } : {}),
    ...(doc.contactPhone ? { contactPhone: doc.contactPhone } : {}),
    policies: toHotelPolicies(doc),
    ...(rooms ? { rooms: rooms.map(toRoomResponse) } : {}),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toHotelSearchItem(
  doc: HotelDocument,
  rooms: RoomDocument[],
  nights: number,
  pricePerNightCents: number,
): HotelSearchItemDto {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description,
    location: toHotelLocation(doc),
    starRating: doc.starRating,
    averageRating: doc.averageRating,
    reviewCount: doc.reviewCount,
    amenities: [...doc.amenities],
    images: toHotelImages(doc),
    currency: rooms[0]?.currency ?? 'USD',
    nights,
    pricePerNightCents,
    totalPriceCents: pricePerNightCents * nights,
    selectedRooms: rooms.map((room) => ({
      roomId: room._id.toString(),
      roomNumber: room.roomNumber,
      name: room.name,
      pricePerNightCents: room.basePricePerNightCents,
      maxAdults: room.maxAdults,
      maxChildren: room.maxChildren,
    })),
  };
}

export function toRoomBlockResponse(doc: RoomAvailabilityDocument): RoomAvailabilityBlockResponseDto {
  return {
    id: doc._id.toString(),
    hotelId: doc.hotelId.toString(),
    roomId: doc.roomId.toString(),
    startDate: doc.startDate,
    endDate: doc.endDate,
    ...(doc.reason ? { reason: doc.reason } : {}),
    createdAt: doc.createdAt.toISOString(),
  };
}

export function toBookingRoom(room: HotelBookingDocument['rooms'][number]): BookedRoomResponseDto {
  return {
    roomId: room.roomId.toString(),
    roomNumber: room.roomNumber,
    roomName: room.roomName,
    pricePerNightCents: room.pricePerNightCents,
    nights: room.nights,
    guests: room.guests.map((guest) => ({
      firstName: guest.firstName,
      lastName: guest.lastName,
      age: guest.age ?? null,
    })),
    subtotalCents: room.subtotalCents,
    ...(room.specialRequests ? { specialRequests: room.specialRequests } : {}),
  };
}

function toCancellation(
  booking: HotelBookingDocument,
): BookingCancellationResponseDto | null {
  if (!booking.cancellation) {
    return null;
  }
  const cancellation = booking.cancellation;
  return {
    cancelledBy: cancellation.cancelledBy,
    ...(cancellation.reason ? { reason: cancellation.reason } : {}),
    cancelledAt: cancellation.cancelledAt.toISOString(),
    daysBeforeCheckIn: cancellation.daysBeforeCheckIn,
    refund: {
      amountCents: cancellation.refund.amountCents,
      percent: cancellation.refund.percent,
      status: cancellation.refund.status,
      providerRefundId: cancellation.refund.providerRefundId ?? null,
      requestedAt: iso(cancellation.refund.requestedAt),
      processedAt: iso(cancellation.refund.processedAt),
      failureReason: cancellation.refund.failureReason ?? null,
    },
  };
}

export function toBookingResponse(
  booking: HotelBookingDocument,
  viewer?: AuthUser,
): HotelBookingResponseDto {
  const holdActive =
    booking.status === HotelBookingStatus.HELD &&
    !!booking.holdExpiresAt &&
    booking.holdExpiresAt.getTime() > Date.now();

  const canReview =
    !!viewer &&
    booking.userId.toString() === viewer.id &&
    booking.status === HotelBookingStatus.COMPLETED &&
    !booking.reviewId;

  return {
    id: booking._id.toString(),
    reference: booking.reference,
    userId: booking.userId.toString(),
    hotelId: booking.hotelId.toString(),
    hotelName: booking.hotelName,
    rooms: booking.rooms.map(toBookingRoom),
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.nights,
    guestCount: booking.guestCount,
    totalAmountCents: booking.totalAmountCents,
    currency: booking.currency,
    status: booking.status,
    holdExpiresAt: iso(booking.holdExpiresAt),
    confirmedAt: iso(booking.confirmedAt),
    completedAt: iso(booking.completedAt),
    expiredAt: iso(booking.expiredAt),
    policiesAcceptedAt: iso(booking.policiesAcceptedAt),
    policySnapshot: {
      checkInTime: booking.policySnapshot.checkInTime,
      checkOutTime: booking.policySnapshot.checkOutTime,
      cancellationTiers: booking.policySnapshot.cancellationTiers.map((tier) => ({
        minDaysBeforeCheckIn: tier.minDaysBeforeCheckIn,
        refundPercent: tier.refundPercent,
        ...(tier.description ? { description: tier.description } : {}),
      })),
      capturedAt: booking.policySnapshot.capturedAt.toISOString(),
    },
    cancellation: toCancellation(booking),
    paymentId: booking.paymentId ?? null,
    reviewId: booking.reviewId ? booking.reviewId.toString() : null,
    ...(booking.notes ? { notes: booking.notes } : {}),
    canReview,
    holdActive,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}

export function toReviewResponse(doc: ReviewDocument): ReviewResponseDto {
  return {
    id: doc._id.toString(),
    hotelId: doc.hotelId.toString(),
    bookingId: doc.bookingId.toString(),
    userId: doc.userId.toString(),
    rating: doc.rating,
    ...(doc.title ? { title: doc.title } : {}),
    comment: doc.comment,
    isHidden: doc.isHidden,
    hiddenReason: doc.hiddenReason ?? null,
    isDeleted: doc.isDeleted,
    moderatorReply: doc.moderatorReply
      ? {
          body: doc.moderatorReply.body,
          repliedBy: doc.moderatorReply.repliedBy.toString(),
          repliedAt: doc.moderatorReply.repliedAt.toISOString(),
        }
      : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export interface RoomCalendarSource {
  room: RoomDocument;
  days: Array<{ date: string; status: 'available' | 'blocked' | 'held' | 'booked' }>;
}

export function toRoomCalendar(source: RoomCalendarSource): RoomCalendarDto {
  return {
    roomId: source.room._id.toString(),
    roomNumber: source.room.roomNumber,
    name: source.room.name,
    isActive: source.room.isActive,
    days: source.days.map((day) => ({
      date: day.date,
      status: day.status,
      pricePerNightCents: source.room.basePricePerNightCents,
    })),
  };
}

export function toHotelCalendar(
  hotelId: string,
  from: string,
  to: string,
  rooms: RoomCalendarSource[],
): HotelCalendarDto {
  return { hotelId, from, to, rooms: rooms.map(toRoomCalendar) };
}
