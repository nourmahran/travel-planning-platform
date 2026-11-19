import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { MAX_BLOCK_DAYS, MAX_CALENDAR_DAYS, MAX_STAY_NIGHTS } from '../shared/constants';
import type { AuthUser } from '../shared/auth/auth-user';
import {
  addDaysISO,
  assertValidStay,
  differenceInCalendarDays,
  eachDateInclusive,
  parseISODate,
  todayISO,
} from '../shared/utils/date.util';
import { isDuplicateKeyError, runInTransaction } from '../shared/utils/transaction.util';
import { toObjectId } from '../shared/utils/object-id.util';
import { AvailabilityService } from './availability.service';
import {
  BlockRoomDatesDto,
  CreateRoomDto,
  HotelAvailabilityQueryDto,
  AvailableRoomsQueryDto,
  UpdateRoomBlockDto,
  UpdateRoomDto,
} from './dto/room.dto';
import {
  AvailableRoomDto,
  AvailableRoomsResponseDto,
  HotelCalendarDto,
  RoomAvailabilityBlockResponseDto,
  RoomResponseDto,
} from './dto/responses.dto';
import { splitGuests } from './domain/occupancy.util';
import { HotelsService } from './hotels.service';
import { toHotelCalendar, toRoomBlockResponse, toRoomResponse } from './mappers/response.mapper';
import { HotelBooking, HotelBookingDocument } from './schemas/hotel-booking.schema';
import { ACTIVE_BOOKING_STATUSES } from './schemas/hotel-booking.schema';
import { RoomAvailability, RoomAvailabilityDocument } from './schemas/room-availability.schema';
import { RoomLockKind } from './schemas/room-night-lock.schema';
import { Room, RoomDocument } from './schemas/room.schema';

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(RoomAvailability.name)
    private readonly blockModel: Model<RoomAvailabilityDocument>,
    @InjectModel(HotelBooking.name)
    private readonly bookingModel: Model<HotelBookingDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly hotels: HotelsService,
    private readonly availability: AvailabilityService,
  ) {}

  // -------------------------------------------------------------------------
  // HTL-03 / HTL-04: room management
  // -------------------------------------------------------------------------

  async create(
    hotelId: Types.ObjectId,
    dto: CreateRoomDto,
    user: AuthUser,
  ): Promise<RoomResponseDto> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    this.hotels.assertCanManage(user, hotel);

    const room = new this.roomModel({
      hotelId: hotel._id,
      roomNumber: dto.roomNumber,
      name: dto.name,
      description: dto.description,
      bedType: dto.bedType,
      bedCount: dto.bedCount,
      maxAdults: dto.maxAdults,
      maxChildren: dto.maxChildren,
      basePricePerNightCents: dto.basePricePerNightCents,
      currency: this.hotels.platformCurrency(),
      amenities: this.normalizeAmenities(dto.amenities),
      images: (dto.images ?? []).map((image) => ({
        url: image.url,
        ...(image.caption ? { caption: image.caption } : {}),
      })),
      ...(dto.sizeSqm !== undefined ? { sizeSqm: dto.sizeSqm } : {}),
      ...(dto.floor !== undefined ? { floor: dto.floor } : {}),
      isActive: dto.isActive ?? true,
    });

    try {
      await room.save();
    } catch (error) {
      this.rethrowDuplicateRoomNumber(error);
      throw error;
    }

    return toRoomResponse(room);
  }

  async list(hotelId: Types.ObjectId, viewer?: AuthUser): Promise<RoomResponseDto[]> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    const canManage = viewer ? this.hotels.canManage(viewer, hotel) : false;
    if (!hotel.isActive && !canManage) {
      throw new NotFoundException('Hotel not found.');
    }

    const rooms = await this.hotels.listRoomDocuments(hotel._id, canManage);
    return rooms.map(toRoomResponse);
  }

  async update(
    hotelId: Types.ObjectId,
    roomId: Types.ObjectId,
    dto: UpdateRoomDto,
    user: AuthUser,
  ): Promise<RoomResponseDto> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    this.hotels.assertCanManage(user, hotel);
    const room = await this.getRoomOrThrow(hotel._id, roomId);

    if (dto.roomNumber !== undefined && dto.roomNumber !== room.roomNumber) {
      const duplicate = await this.roomModel.exists({
        hotelId: hotel._id,
        roomNumber: dto.roomNumber,
        _id: { $ne: room._id },
      });
      if (duplicate) {
        throw new ConflictException(`Room number ${dto.roomNumber} already exists in this hotel.`);
      }
      room.roomNumber = dto.roomNumber;
    }

    if (dto.maxAdults !== undefined || dto.maxChildren !== undefined) {
      await this.assertCapacityChangeAllowed(
        room,
        dto.maxAdults ?? room.maxAdults,
        dto.maxChildren ?? room.maxChildren,
      );
    }

    if (dto.name !== undefined) room.name = dto.name;
    if (dto.description !== undefined) room.description = dto.description;
    if (dto.bedType !== undefined) room.bedType = dto.bedType;
    if (dto.bedCount !== undefined) room.bedCount = dto.bedCount;
    if (dto.maxAdults !== undefined) room.maxAdults = dto.maxAdults;
    if (dto.maxChildren !== undefined) room.maxChildren = dto.maxChildren;
    if (dto.basePricePerNightCents !== undefined) {
      room.basePricePerNightCents = dto.basePricePerNightCents;
    }
    if (dto.sizeSqm !== undefined) room.sizeSqm = dto.sizeSqm;
    if (dto.floor !== undefined) room.floor = dto.floor;
    if (dto.isActive !== undefined) room.isActive = dto.isActive;
    if (dto.amenities !== undefined) room.amenities = this.normalizeAmenities(dto.amenities);
    if (dto.images !== undefined) {
      room.images = dto.images.map((image) => ({
        url: image.url,
        ...(image.caption ? { caption: image.caption } : {}),
      }));
    }

    try {
      await room.save();
    } catch (error) {
      this.rethrowDuplicateRoomNumber(error);
      throw error;
    }

    return toRoomResponse(room);
  }

  /**
   * HTL-07: deletion is only allowed when nothing is held or booked.
   * Otherwise the room must be deactivated, which keeps existing reservations.
   */
  async remove(
    hotelId: Types.ObjectId,
    roomId: Types.ObjectId,
    user: AuthUser,
  ): Promise<{ deleted: true; roomId: string }> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    this.hotels.assertCanManage(user, hotel);
    const room = await this.getRoomOrThrow(hotel._id, roomId);

    const blocking = await this.bookingModel.exists({
      hotelId: hotel._id,
      'rooms.roomId': room._id,
      status: { $in: ACTIVE_BOOKING_STATUSES },
      checkOut: { $gt: todayISO() },
    });
    if (blocking) {
      throw new ConflictException(
        'This room has active or upcoming reservations. Deactivate the room instead of deleting it.',
      );
    }

    await this.availability.removeBlockLocksForRoom(room._id);
    await this.blockModel.deleteMany({ roomId: room._id });
    await room.deleteOne();

    return { deleted: true, roomId: room._id.toString() };
  }

  // -------------------------------------------------------------------------
  // HTL-15: rooms available for the entire stay
  // -------------------------------------------------------------------------

  async available(
    hotelId: Types.ObjectId,
    query: AvailableRoomsQueryDto,
    viewer?: AuthUser,
  ): Promise<AvailableRoomsResponseDto> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    const canManage = viewer ? this.hotels.canManage(viewer, hotel) : false;
    if (!hotel.isActive && !canManage) {
      throw new NotFoundException('Hotel not found.');
    }

    const stay = assertValidStay(query.checkIn, query.checkOut, { maxNights: MAX_STAY_NIGHTS });
    const rooms = await this.availability.findAvailableRooms(
      hotel._id,
      stay.checkIn,
      stay.checkOut,
      query.guests,
    );

    const items: AvailableRoomDto[] = rooms.map((room) => ({
      ...toRoomResponse(room),
      nights: stay.nights,
      totalPriceCents: room.basePricePerNightCents * stay.nights,
    }));

    return {
      hotelId: hotel._id.toString(),
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      nights: stay.nights,
      currency: this.hotels.platformCurrency(),
      rooms: items,
    };
  }

  // -------------------------------------------------------------------------
  // HTL-04 / HTL-05 / HTL-06: available and blocked date ranges
  // -------------------------------------------------------------------------

  async blockDates(
    hotelId: Types.ObjectId,
    roomId: Types.ObjectId,
    dto: BlockRoomDatesDto,
    user: AuthUser,
  ): Promise<RoomAvailabilityBlockResponseDto> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    this.hotels.assertCanManage(user, hotel);
    const room = await this.getRoomOrThrow(hotel._id, roomId);
    this.validateBlockRange(dto.startDate, dto.endDate);

    const blockId = new Types.ObjectId();
    try {
      await runInTransaction(this.connection, async (session) => {
        await this.assertNoBookingConflict(room._id, dto.startDate, dto.endDate, session);
        await this.assertNoOtherBlock(room._id, dto.startDate, dto.endDate, undefined, session);

        await this.blockModel.create(
          [
            {
              _id: blockId,
              hotelId: hotel._id,
              roomId: room._id,
              startDate: dto.startDate,
              endDate: dto.endDate,
              ...(dto.reason ? { reason: dto.reason } : {}),
              createdBy: toObjectId(user.id, 'user id'),
            },
          ],
          { session },
        );

        await this.availability.replaceBlockLocks({
          blockId,
          hotelId: hotel._id,
          roomId: room._id,
          startDate: dto.startDate,
          endDate: dto.endDate,
          session,
        });
      });
    } catch (error) {
      this.rethrowBlockConflict(error);
      throw error;
    }

    const block = await this.blockModel.findById(blockId).exec();
    if (!block) {
      throw new NotFoundException('Availability block was not created.');
    }
    return toRoomBlockResponse(block);
  }

  async updateBlock(
    hotelId: Types.ObjectId,
    roomId: Types.ObjectId,
    blockId: Types.ObjectId,
    dto: UpdateRoomBlockDto,
    user: AuthUser,
  ): Promise<RoomAvailabilityBlockResponseDto> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    this.hotels.assertCanManage(user, hotel);
    const room = await this.getRoomOrThrow(hotel._id, roomId);
    const block = await this.getBlockOrThrow(hotel._id, room._id, blockId);

    const startDate = dto.startDate ?? block.startDate;
    const endDate = dto.endDate ?? block.endDate;
    this.validateBlockRange(startDate, endDate);

    try {
      await runInTransaction(this.connection, async (session) => {
        await this.assertNoBookingConflict(room._id, startDate, endDate, session);
        await this.assertNoOtherBlock(room._id, startDate, endDate, block._id, session);

        block.startDate = startDate;
        block.endDate = endDate;
        if (dto.reason !== undefined) {
          block.reason = dto.reason;
        }
        await block.save({ session });

        await this.availability.replaceBlockLocks({
          blockId: block._id,
          hotelId: hotel._id,
          roomId: room._id,
          startDate,
          endDate,
          session,
        });
      });
    } catch (error) {
      this.rethrowBlockConflict(error);
      throw error;
    }

    return toRoomBlockResponse(block);
  }

  async deleteBlock(
    hotelId: Types.ObjectId,
    roomId: Types.ObjectId,
    blockId: Types.ObjectId,
    user: AuthUser,
  ): Promise<{ deleted: true; blockId: string }> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    this.hotels.assertCanManage(user, hotel);
    const room = await this.getRoomOrThrow(hotel._id, roomId);
    const block = await this.getBlockOrThrow(hotel._id, room._id, blockId);

    await runInTransaction(this.connection, async (session) => {
      await this.availability.removeBlockLocks(block._id, session);
      await block.deleteOne({ session });
    });

    return { deleted: true, blockId: block._id.toString() };
  }

  async listBlocks(
    hotelId: Types.ObjectId,
    roomId: Types.ObjectId,
    user: AuthUser,
  ): Promise<RoomAvailabilityBlockResponseDto[]> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    this.hotels.assertCanManage(user, hotel);
    const room = await this.getRoomOrThrow(hotel._id, roomId);

    const blocks = await this.blockModel
      .find({ hotelId: hotel._id, roomId: room._id })
      .sort({ startDate: 1 })
      .exec();
    return blocks.map(toRoomBlockResponse);
  }

  // -------------------------------------------------------------------------
  // HTL-08: availability calendar
  // -------------------------------------------------------------------------

  async calendar(
    hotelId: Types.ObjectId,
    query: HotelAvailabilityQueryDto,
    viewer?: AuthUser,
  ): Promise<HotelCalendarDto> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    const canManage = viewer ? this.hotels.canManage(viewer, hotel) : false;
    if (!hotel.isActive && !canManage) {
      throw new NotFoundException('Hotel not found.');
    }

    const from = query.from ?? todayISO();
    const to = query.to ?? addDaysISO(from, 30);
    parseISODate(from, 'from');
    parseISODate(to, 'to');
    if (to < from) {
      throw new BadRequestException('to must be on or after from.');
    }
    if (differenceInCalendarDays(from, to) > MAX_CALENDAR_DAYS) {
      throw new BadRequestException(`The calendar window cannot exceed ${MAX_CALENDAR_DAYS} days.`);
    }

    let rooms = await this.hotels.listRoomDocuments(hotel._id, canManage);
    if (query.roomId) {
      const roomId = toObjectId(query.roomId, 'roomId');
      rooms = rooms.filter((room) => room._id.equals(roomId));
      if (rooms.length === 0) {
        throw new NotFoundException('Room not found in this hotel.');
      }
    }

    const dates = eachDateInclusive(from, to);
    const maps = await this.availability.getMaps(
      rooms.map((room) => room._id),
      from,
      addDaysISO(to, 1),
    );

    // HTL-08: managers see which reservation occupies a night; the public
    // calendar shows only the status.
    const references = new Map<string, string>();
    if (canManage) {
      const bookingIds = new Set<string>();
      for (const roomLocks of maps.locked.values()) {
        for (const lock of roomLocks.values()) {
          if (lock.kind !== RoomLockKind.BLOCK && lock.bookingId) {
            bookingIds.add(lock.bookingId.toString());
          }
        }
      }
      if (bookingIds.size) {
        const bookings = await this.bookingModel
          .find({ _id: { $in: [...bookingIds].map((id) => new Types.ObjectId(id)) } })
          .select('reference')
          .lean()
          .exec();
        for (const booking of bookings) {
          if (booking.reference) references.set(booking._id.toString(), booking.reference);
        }
      }
    }

    const sources = rooms.map((room) => {
      const roomKey = room._id.toString();
      const locked = maps.locked.get(roomKey);
      const blocked = maps.blocked.get(roomKey);

      const days = dates.map((date) => {
        const lock = locked?.get(date);
        if (lock) {
          if (lock.kind === RoomLockKind.BLOCK) {
            return { date, status: 'blocked' as const };
          }
          const reservationReference = lock.bookingId
            ? references.get(lock.bookingId.toString())
            : undefined;
          if (lock.kind === RoomLockKind.HOLD) {
            return { date, status: 'held' as const, reservationReference };
          }
          return { date, status: 'booked' as const, reservationReference };
        }
        if (blocked?.has(date)) {
          return { date, status: 'blocked' as const };
        }
        return { date, status: 'available' as const };
      });

      return { room, days };
    });

    return toHotelCalendar(hotel._id.toString(), from, to, sources);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async getRoomOrThrow(
    hotelId: Types.ObjectId,
    roomId: Types.ObjectId,
  ): Promise<RoomDocument> {
    const room = await this.roomModel.findOne({ _id: roomId, hotelId }).exec();
    if (!room) {
      throw new NotFoundException('Room not found in this hotel.');
    }
    return room;
  }

  private async getBlockOrThrow(
    hotelId: Types.ObjectId,
    roomId: Types.ObjectId,
    blockId: Types.ObjectId,
  ): Promise<RoomAvailabilityDocument> {
    const block = await this.blockModel.findOne({ _id: blockId, hotelId, roomId }).exec();
    if (!block) {
      throw new NotFoundException('Availability block not found for this room.');
    }
    return block;
  }

  private validateBlockRange(startDate: string, endDate: string): void {
    parseISODate(startDate, 'startDate');
    parseISODate(endDate, 'endDate');

    if (startDate < todayISO()) {
      throw new BadRequestException('startDate cannot be in the past.');
    }
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be on or after startDate.');
    }
    if (differenceInCalendarDays(startDate, endDate) + 1 > MAX_BLOCK_DAYS) {
      throw new ConflictException(`A single block cannot exceed ${MAX_BLOCK_DAYS} days.`);
    }
  }

  /** A reservation occupies [checkIn, checkOut - 1]. */
  private async assertNoBookingConflict(
    roomId: Types.ObjectId,
    startDate: string,
    endDate: string,
    session?: ClientSession,
  ): Promise<void> {
    const conflictingQuery = this.bookingModel.exists({
      'rooms.roomId': roomId,
      status: { $in: ACTIVE_BOOKING_STATUSES },
      checkIn: { $lte: endDate },
      checkOut: { $gt: startDate },
    });
    const conflicting = await (session ? conflictingQuery.session(session) : conflictingQuery);
    if (conflicting) {
      throw new ConflictException(
        'The room has an active or held reservation that overlaps this blocked range.',
      );
    }
  }

  private async assertNoOtherBlock(
    roomId: Types.ObjectId,
    startDate: string,
    endDate: string,
    excludeBlockId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const filter = {
      roomId,
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
      ...(excludeBlockId ? { _id: { $ne: excludeBlockId } } : {}),
    };
    const existingQuery = this.blockModel.exists(filter);
    const existing = await (session ? existingQuery.session(session) : existingQuery);
    if (existing) {
      throw new ConflictException('This date range overlaps another blocked range for the room.');
    }
  }

  /** HTL-05: a capacity reduction must still fit every upcoming reservation. */
  private async assertCapacityChangeAllowed(
    room: RoomDocument,
    maxAdults: number,
    maxChildren: number,
  ): Promise<void> {
    if (maxAdults === room.maxAdults && maxChildren === room.maxChildren) {
      return;
    }

    const upcoming = await this.bookingModel
      .find({
        'rooms.roomId': room._id,
        status: { $in: ACTIVE_BOOKING_STATUSES },
        checkOut: { $gt: todayISO() },
      })
      .exec();

    for (const booking of upcoming) {
      const bookedRoom = booking.rooms.find((candidate) => candidate.roomId.equals(room._id));
      if (!bookedRoom) {
        continue;
      }
      const { adults, children } = splitGuests(bookedRoom.guests);
      if (adults > maxAdults || children > maxChildren) {
        throw new ConflictException(
          `Cannot reduce the capacity of room ${room.roomNumber}: reservation ${booking.reference} has ${adults} adult(s) and ${children} child(ren) assigned to it.`,
        );
      }
    }
  }

  private normalizeAmenities(amenities?: string[]): string[] {
    if (!amenities) {
      return [];
    }
    return [...new Set(amenities.map((amenity) => amenity.trim().toLowerCase()).filter(Boolean))];
  }

  private rethrowDuplicateRoomNumber(error: unknown): void {
    if (isDuplicateKeyError(error)) {
      throw new ConflictException('A room with this room number already exists in this hotel.');
    }
  }

  private rethrowBlockConflict(error: unknown): void {
    if (isDuplicateKeyError(error)) {
      throw new ConflictException(
        'The room is already booked, held, or blocked for at least one night in this range.',
      );
    }
  }
}
