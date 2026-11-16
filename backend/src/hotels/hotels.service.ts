import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { QueryFilter as FilterQuery } from 'mongoose';
import type { AuthUser } from '../shared/auth/auth-user';
import { FALLBACK_CURRENCY, MAX_STAY_NIGHTS } from '../shared/constants';
import { PaginatedResult, paginate } from '../shared/dto/pagination-query.dto';
import { assertValidStay, enumerateNights } from '../shared/utils/date.util';
import { envString } from '../shared/utils/env.util';
import { toObjectId } from '../shared/utils/object-id.util';
import { AvailabilityMaps, AvailabilityService } from './availability.service';
import {
  CreateHotelDto,
  HotelPoliciesDto,
  HotelSearchSort,
  SearchHotelsQueryDto,
  UpdateHotelDto,
} from './dto/hotel.dto';
import {
  HotelPoliciesResponseDto,
  HotelResponseDto,
  HotelSearchItemDto,
} from './dto/responses.dto';
import { selectCheapestRoomCombination } from './domain/room-selection.util';
import { normalizeCancellationTiers } from './domain/refund-policy.util';
import { toHotelPolicies, toHotelResponse, toHotelSearchItem, toRoomResponse } from './mappers/response.mapper';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { Room, RoomDocument } from './schemas/room.schema';

const CANDIDATE_LIMIT = 200;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class HotelsService implements OnModuleInit {
  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<HotelDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    private readonly availability: AvailabilityService,
  ) {}

  /** Wait for the hotel/room unique indexes before serving requests. */
  async onModuleInit(): Promise<void> {
    await Promise.all([this.hotelModel.init(), this.roomModel.init()]);
  }

  // -------------------------------------------------------------------------
  // HTL-01 / HTL-02: hotel creation, profile and details
  // -------------------------------------------------------------------------

  async create(dto: CreateHotelDto, user: AuthUser): Promise<HotelResponseDto> {
    let moderatorId: Types.ObjectId | null = null;

    if (dto.moderatorId) {
      if (user.role !== 'ADMIN') {
        throw new ForbiddenException('Only an administrator can assign a hotel moderator.');
      }
      moderatorId = toObjectId(dto.moderatorId, 'moderatorId');
    } else if (user.role === 'HOTEL_MODERATOR') {
      if (user.providerId) {
        throw new ForbiddenException('This moderator is already assigned to a hotel.');
      }
      moderatorId = toObjectId(user.id, 'user id');
    }

    if (moderatorId) {
      const assigned = await this.hotelModel.exists({ moderatorId });
      if (assigned) {
        throw new ConflictException('This hotel moderator already manages a hotel.');
      }
    }

    const hotel = new this.hotelModel({
      ...dto,
      moderatorId,
      location: { ...dto.location },
      amenities: this.normalizeAmenities(dto.amenities),
      images: (dto.images ?? []).map((image) => ({ url: image.url, ...(image.caption ? { caption: image.caption } : {}) })),
    });

    try {
      await hotel.save();
    } catch (error) {
      this.rethrowDuplicateHotel(error);
      throw error;
    }

    return toHotelResponse(hotel);
  }

  async findOne(id: Types.ObjectId, viewer?: AuthUser): Promise<HotelResponseDto> {
    const hotel = await this.getHotelOrThrow(id);
    const canManage = viewer ? this.canManage(viewer, hotel) : false;

    if (!hotel.isActive && !canManage) {
      throw new NotFoundException('Hotel not found.');
    }

    const rooms = await this.roomModel
      .find({ hotelId: hotel._id, ...(canManage ? {} : { isActive: true }) })
      .sort({ basePricePerNightCents: 1, roomNumber: 1 })
      .exec();

    return toHotelResponse(hotel, rooms);
  }

  async update(id: Types.ObjectId, dto: UpdateHotelDto, user: AuthUser): Promise<HotelResponseDto> {
    const hotel = await this.getHotelOrThrow(id);
    this.assertCanManage(user, hotel);

    if (dto.isActive !== undefined && user.role !== 'ADMIN') {
      throw new ForbiddenException('Only an administrator can activate or deactivate a hotel.');
    }
    if (dto.moderatorId !== undefined && user.role !== 'ADMIN') {
      throw new ForbiddenException('Only an administrator can reassign a hotel moderator.');
    }

    if (dto.moderatorId !== undefined) {
      const moderatorId = toObjectId(dto.moderatorId, 'moderatorId');
      const assigned = await this.hotelModel.exists({
        moderatorId,
        _id: { $ne: hotel._id },
      });
      if (assigned) {
        throw new ConflictException('This hotel moderator already manages a hotel.');
      }
      hotel.moderatorId = moderatorId;
    }

    if (dto.name !== undefined) hotel.name = dto.name;
    if (dto.description !== undefined) hotel.description = dto.description;
    if (dto.starRating !== undefined) hotel.starRating = dto.starRating;
    if (dto.contactEmail !== undefined) hotel.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined) hotel.contactPhone = dto.contactPhone;
    if (dto.isActive !== undefined) hotel.isActive = dto.isActive;
    if (dto.location !== undefined) hotel.location = { ...dto.location };
    if (dto.amenities !== undefined) hotel.amenities = this.normalizeAmenities(dto.amenities);
    if (dto.images !== undefined) {
      hotel.images = dto.images.map((image) => ({
        url: image.url,
        ...(image.caption ? { caption: image.caption } : {}),
      }));
    }

    try {
      await hotel.save();
    } catch (error) {
      this.rethrowDuplicateHotel(error);
      throw error;
    }

    return this.findOne(hotel._id, user);
  }

  // -------------------------------------------------------------------------
  // HTL-09 / HTL-10: check-in/out rules and cancellation tiers
  // -------------------------------------------------------------------------

  async replacePolicies(
    id: Types.ObjectId,
    dto: HotelPoliciesDto,
    user: AuthUser,
  ): Promise<HotelPoliciesResponseDto> {
    const hotel = await this.getHotelOrThrow(id);
    this.assertCanManage(user, hotel);

    hotel.policies = {
      checkInTime: dto.checkInTime,
      checkOutTime: dto.checkOutTime,
      cancellationTiers: normalizeCancellationTiers(dto.cancellationTiers),
      childrenAllowed: dto.childrenAllowed ?? true,
      ...(dto.notes ? { notes: dto.notes } : {}),
    };
    await hotel.save();

    return toHotelPolicies(hotel);
  }

  // -------------------------------------------------------------------------
  // HTL-11 / HTL-12: search by destination, dates, guests, rooms; filters+sort
  // -------------------------------------------------------------------------

  async search(query: SearchHotelsQueryDto): Promise<PaginatedResult<HotelSearchItemDto>> {
    if (
      query.minPriceCents !== undefined &&
      query.maxPriceCents !== undefined &&
      query.minPriceCents > query.maxPriceCents
    ) {
      throw new BadRequestException('minPriceCents cannot be greater than maxPriceCents.');
    }

    const stay = this.parseOptionalStay(query.checkIn, query.checkOut);

    const filter: FilterQuery<HotelDocument> = { isActive: true };
    if (query.city?.trim()) {
      filter['location.city'] = { $regex: `^${escapeRegex(query.city.trim())}$`, $options: 'i' };
    }
    if (query.country?.trim()) {
      filter['location.country'] = { $regex: `^${escapeRegex(query.country.trim())}$`, $options: 'i' };
    }
    if (query.minRating !== undefined) {
      filter.averageRating = { $gte: query.minRating };
    }
    if (query.amenities?.length) {
      filter.amenities = { $all: query.amenities.map((amenity) => amenity.toLowerCase()) };
    }

    const hotels = await this.hotelModel.find(filter).limit(CANDIDATE_LIMIT).exec();
    if (hotels.length === 0) {
      return paginate<HotelSearchItemDto>([], 0, query.page, query.limit);
    }

    const rooms = await this.roomModel
      .find({ hotelId: { $in: hotels.map((hotel) => hotel._id) }, isActive: true })
      .exec();

    const roomsByHotel = new Map<string, RoomDocument[]>();
    for (const room of rooms) {
      const key = room.hotelId.toString();
      const list = roomsByHotel.get(key) ?? [];
      list.push(room);
      roomsByHotel.set(key, list);
    }

    const nights = stay ? enumerateNights(stay.checkIn, stay.checkOut) : [];
    const maps: AvailabilityMaps = stay
      ? await this.availability.getMaps(
          rooms.map((room) => room._id),
          stay.checkIn,
          stay.checkOut,
        )
      : { blocked: new Map(), locked: new Map() };

    const items: HotelSearchItemDto[] = [];
    for (const hotel of hotels) {
      const hotelRooms = (roomsByHotel.get(hotel._id.toString()) ?? []).filter((room) =>
        this.availability.roomIsFree(room._id, nights, maps),
      );

      const selection = selectCheapestRoomCombination(hotelRooms, query.rooms, query.guests);
      if (!selection) {
        continue;
      }
      if (query.minPriceCents !== undefined && selection.pricePerNightCents < query.minPriceCents) {
        continue;
      }
      if (query.maxPriceCents !== undefined && selection.pricePerNightCents > query.maxPriceCents) {
        continue;
      }

      items.push(
        toHotelSearchItem(
          hotel,
          selection.rooms,
          Math.max(nights.length, 1),
          selection.pricePerNightCents,
        ),
      );
    }

    this.sortSearchResults(items, query.sort);

    const total = items.length;
    const start = query.skip;
    return paginate(items.slice(start, start + query.limit), total, query.page, query.limit);
  }

  // -------------------------------------------------------------------------
  // Shared helpers used by rooms, bookings and reviews
  // -------------------------------------------------------------------------

  async getHotelOrThrow(id: Types.ObjectId): Promise<HotelDocument> {
    const hotel = await this.hotelModel.findById(id).exec();
    if (!hotel) {
      throw new NotFoundException('Hotel not found.');
    }
    return hotel;
  }

  assertCanManage(user: AuthUser, hotel: HotelDocument): void {
    if (this.canManage(user, hotel)) {
      return;
    }
    throw new ForbiddenException(
      'Only the hotel moderator assigned to this hotel or an administrator can perform this action.',
    );
  }

  canManage(user: AuthUser, hotel: HotelDocument): boolean {
    if (user.role === 'ADMIN') {
      return true;
    }
    return (
      user.role === 'HOTEL_MODERATOR' &&
      (hotel.moderatorId?.toString() === user.id || hotel._id.toString() === user.providerId)
    );
  }

  platformCurrency(): string {
    return envString('PLATFORM_CURRENCY', FALLBACK_CURRENCY).toUpperCase();
  }

  /** ACC-15: administrator provider deactivation for hotels (Member 1 calls this). */
  async setProviderActive(
    id: Types.ObjectId,
    isActive: boolean,
    user: AuthUser,
  ): Promise<HotelResponseDto> {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Only an administrator can activate or deactivate a hotel.');
    }
    const hotel = await this.getHotelOrThrow(id);
    hotel.isActive = isActive;
    await hotel.save();
    return toHotelResponse(hotel);
  }

  async listRoomDocuments(hotelId: Types.ObjectId, includeInactive: boolean): Promise<RoomDocument[]> {
    return this.roomModel
      .find({ hotelId, ...(includeInactive ? {} : { isActive: true }) })
      .sort({ basePricePerNightCents: 1, roomNumber: 1 })
      .exec();
  }

  private parseOptionalStay(
    checkIn?: string,
    checkOut?: string,
  ): { checkIn: string; checkOut: string } | null {
    if (!checkIn && !checkOut) {
      return null;
    }
    if (!checkIn || !checkOut) {
      throw new BadRequestException('Provide both checkIn and checkOut, or neither.');
    }
    const stay = assertValidStay(checkIn, checkOut, { maxNights: MAX_STAY_NIGHTS });
    return { checkIn: stay.checkIn, checkOut: stay.checkOut };
  }

  private sortSearchResults(items: HotelSearchItemDto[], sort: HotelSearchSort): void {
    const byName = (a: HotelSearchItemDto, b: HotelSearchItemDto) => a.name.localeCompare(b.name);
    switch (sort) {
      case 'price_asc':
        items.sort((a, b) => a.pricePerNightCents - b.pricePerNightCents || byName(a, b));
        break;
      case 'price_desc':
        items.sort((a, b) => b.pricePerNightCents - a.pricePerNightCents || byName(a, b));
        break;
      case 'rating_asc':
        items.sort((a, b) => a.averageRating - b.averageRating || byName(a, b));
        break;
      case 'stars_desc':
        items.sort((a, b) => b.starRating - a.starRating || b.averageRating - a.averageRating);
        break;
      case 'name_asc':
        items.sort(byName);
        break;
      case 'rating_desc':
      default:
        items.sort(
          (a, b) =>
            b.averageRating - a.averageRating ||
            b.reviewCount - a.reviewCount ||
            byName(a, b),
        );
        break;
    }
  }

  private normalizeAmenities(amenities?: string[]): string[] {
    if (!amenities) {
      return [];
    }
    return [...new Set(amenities.map((amenity) => amenity.trim().toLowerCase()).filter(Boolean))];
  }

  private rethrowDuplicateHotel(error: unknown): void {
    if (this.isDuplicateKey(error)) {
      throw new ConflictException('A hotel with this name already exists in that city and country.');
    }
  }

  private isDuplicateKey(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
  }

  /** Convenience for Member 6 / Member 1 (hotel picker in moderation screens). */
  async findHotelSummary(id: Types.ObjectId): Promise<HotelResponseDto> {
    const hotel = await this.getHotelOrThrow(id);
    return toHotelResponse(hotel, await this.listRoomDocuments(hotel._id, false));
  }

  async roomResponses(hotelId: Types.ObjectId, includeInactive: boolean) {
    const rooms = await this.listRoomDocuments(hotelId, includeInactive);
    return rooms.map(toRoomResponse);
  }
}
