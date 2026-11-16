import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { eachDateInclusive, enumerateNights } from '../shared/utils/date.util';
import { RoomAvailability, RoomAvailabilityDocument } from './schemas/room-availability.schema';
import {
  RoomLockKind,
  RoomNightLock,
  RoomNightLockDocument,
} from './schemas/room-night-lock.schema';
import { Room, RoomDocument } from './schemas/room.schema';

export interface AvailabilityMaps {
  /** roomId -> dates blocked by the hotel moderator. */
  blocked: Map<string, Set<string>>;
  /** roomId -> date -> lock (hold or confirmed reservation). */
  locked: Map<string, Map<string, RoomNightLockDocument>>;
}

export interface LockTarget {
  _id: Types.ObjectId;
  roomNumber: string;
}

function emptyMaps(): AvailabilityMaps {
  return { blocked: new Map(), locked: new Map() };
}

/**
 * HTL-08 / HTL-15 / HTL-16: the single place that decides whether a room can
 * be sold for a set of nights.
 *
 * Sold inventory has two independent sources:
 *   1. moderator blocks (room_availability_blocks)
 *   2. reservation holds/confirmations (room_night_locks, unique per room+night)
 */
@Injectable()
export class AvailabilityService implements OnModuleInit {
  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(RoomAvailability.name)
    private readonly blockModel: Model<RoomAvailabilityDocument>,
    @InjectModel(RoomNightLock.name)
    private readonly lockModel: Model<RoomNightLockDocument>,
  ) {}

  /**
   * The unique { roomId, date } index is the only thing that makes double
   * booking impossible. Waiting for the index build before accepting requests
   * closes the small startup window where Mongoose is still creating it.
   */
  async onModuleInit(): Promise<void> {
    await this.lockModel.init();
  }

  async getMaps(
    roomIds: Types.ObjectId[],
    checkIn: string,
    checkOut: string,
    session?: ClientSession,
  ): Promise<AvailabilityMaps> {
    const nights = enumerateNights(checkIn, checkOut);
    if (roomIds.length === 0 || nights.length === 0) {
      return emptyMaps();
    }
    const lastNight = nights[nights.length - 1];
    const now = new Date();

    const blockQuery = this.blockModel.find({
      roomId: { $in: roomIds },
      startDate: { $lte: lastNight },
      endDate: { $gte: checkIn },
    });
    if (session) {
      blockQuery.session(session);
    }
    const blocks = await blockQuery.exec();

    const lockQuery = this.lockModel.find({
      roomId: { $in: roomIds },
      date: { $gte: checkIn, $lte: lastNight },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    });
    if (session) {
      lockQuery.session(session);
    }
    const locks = await lockQuery.exec();

    const maps = emptyMaps();
    for (const block of blocks) {
      const roomKey = block.roomId.toString();
      const dates = maps.blocked.get(roomKey) ?? new Set<string>();
      const start = block.startDate > checkIn ? block.startDate : checkIn;
      const end = block.endDate < lastNight ? block.endDate : lastNight;
      for (const date of enumerateNights(start, this.addOneDay(end))) {
        if (date >= checkIn && date <= lastNight) {
          dates.add(date);
        }
      }
      maps.blocked.set(roomKey, dates);
    }

    for (const lock of locks) {
      const roomKey = lock.roomId.toString();
      const dates = maps.locked.get(roomKey) ?? new Map<string, RoomNightLockDocument>();
      dates.set(lock.date, lock);
      maps.locked.set(roomKey, dates);
    }

    return maps;
  }

  roomIsFree(roomId: Types.ObjectId, nights: string[], maps: AvailabilityMaps): boolean {
    const roomKey = roomId.toString();
    const blocked = maps.blocked.get(roomKey);
    const locked = maps.locked.get(roomKey);
    return nights.every((night) => !blocked?.has(night) && !locked?.has(night));
  }

  /** Throws 409 with a useful message if any requested room is not sellable. */
  assertMapsAllowStay(
    rooms: LockTarget[],
    checkIn: string,
    checkOut: string,
    maps: AvailabilityMaps,
  ): void {
    const nights = enumerateNights(checkIn, checkOut);
    for (const room of rooms) {
      const roomKey = room._id.toString();
      const blocked = maps.blocked.get(roomKey);
      const claimed = maps.locked.get(roomKey);
      const blockedNight = nights.find((night) => blocked?.has(night));
      if (blockedNight) {
        throw new ConflictException(
          `Room ${room.roomNumber} is not available on ${blockedNight} (blocked by the hotel).`,
        );
      }
      const claimedNight = nights.find((night) => claimed?.has(night));
      if (claimedNight) {
        throw new ConflictException(
          `Room ${room.roomNumber} is not available on ${claimedNight}: it is already booked, on hold, or blocked.`,
        );
      }
    }
  }

  /**
   * Insert one lock per room per night. The unique { roomId, date } index is
   * the concurrency guard: a racing request fails with E11000 and its whole
   * transaction is rolled back.
   */
  async acquireLocks(params: {
    bookingId: Types.ObjectId;
    hotelId: Types.ObjectId;
    rooms: LockTarget[];
    checkIn: string;
    checkOut: string;
    expiresAt: Date | null;
    session?: ClientSession;
  }): Promise<void> {
    const nights = enumerateNights(params.checkIn, params.checkOut);
    const roomIds = params.rooms.map((room) => room._id);
    const lastNight = nights[nights.length - 1];

    // Expired holds still hold the unique index slot until removed.
    const cleanup = this.lockModel.deleteMany({
      roomId: { $in: roomIds },
      date: { $gte: params.checkIn, $lte: lastNight },
      expiresAt: { $ne: null, $lte: new Date() },
    });
    if (params.session) {
      cleanup.session(params.session);
    }
    await cleanup.exec();

    const documents = params.rooms.flatMap((room) =>
      nights.map((date) => ({
        date,
        hotelId: params.hotelId,
        roomId: room._id,
        bookingId: params.bookingId,
        sourceId: null,
        kind: RoomLockKind.HOLD,
        expiresAt: params.expiresAt,
      })),
    );

    await this.lockModel.insertMany(documents, {
      ordered: true,
      ...(params.session ? { session: params.session } : {}),
    });
  }

  /**
   * HTL-04..HTL-06: a moderator block is stored twice: as a readable range in
   * room_availability_blocks and as one lock per night. The lock insert makes
   * "block a room" and "book a room" mutually exclusive under concurrency.
   */
  async replaceBlockLocks(params: {
    blockId: Types.ObjectId;
    hotelId: Types.ObjectId;
    roomId: Types.ObjectId;
    startDate: string;
    endDate: string;
    session?: ClientSession;
  }): Promise<void> {
    const deletion = this.lockModel.deleteMany({ sourceId: params.blockId });
    if (params.session) {
      deletion.session(params.session);
    }
    await deletion.exec();

    const documents = eachDateInclusive(params.startDate, params.endDate).map((date) => ({
      date,
      hotelId: params.hotelId,
      roomId: params.roomId,
      bookingId: null,
      sourceId: params.blockId,
      kind: RoomLockKind.BLOCK,
      expiresAt: null,
    }));

    await this.lockModel.insertMany(documents, {
      ordered: true,
      ...(params.session ? { session: params.session } : {}),
    });
  }

  async removeBlockLocks(blockId: Types.ObjectId, session?: ClientSession): Promise<void> {
    const deletion = this.lockModel.deleteMany({ sourceId: blockId });
    if (session) {
      deletion.session(session);
    }
    await deletion.exec();
  }

  /** Deletes every moderator-block night of a room (used when the room is deleted). */
  async removeBlockLocksForRoom(
    roomId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const deletion = this.lockModel.deleteMany({ roomId, kind: RoomLockKind.BLOCK });
    if (session) {
      deletion.session(session);
    }
    await deletion.exec();
  }

  async markConfirmed(bookingId: Types.ObjectId, session?: ClientSession): Promise<void> {
    const update = this.lockModel.updateMany(
      { bookingId },
      { $set: { expiresAt: null, kind: RoomLockKind.BOOKING } },
    );
    if (session) {
      update.session(session);
    }
    await update.exec();
  }

  async releaseLocks(bookingId: Types.ObjectId, session?: ClientSession): Promise<void> {
    const deletion = this.lockModel.deleteMany({ bookingId });
    if (session) {
      deletion.session(session);
    }
    await deletion.exec();
  }

  /** Removes locks of holds that already expired (safe to run repeatedly). */
  async purgeExpiredLocks(): Promise<number> {
    const result = await this.lockModel.deleteMany({ expiresAt: { $ne: null, $lte: new Date() } });
    return result.deletedCount ?? 0;
  }

  /** Removes locks for stays that ended before `date` (defaults to today). */
  async purgeOldLocks(beforeDate: string): Promise<number> {
    const result = await this.lockModel.deleteMany({ date: { $lt: beforeDate } });
    return result.deletedCount ?? 0;
  }

  async findAvailableRooms(
    hotelId: Types.ObjectId,
    checkIn: string,
    checkOut: string,
    guests?: number,
  ): Promise<RoomDocument[]> {
    const rooms = await this.roomModel
      .find({ hotelId, isActive: true })
      .sort({ basePricePerNightCents: 1, roomNumber: 1 })
      .exec();
    if (rooms.length === 0) {
      return [];
    }
    const maps = await this.getMaps(
      rooms.map((room) => room._id),
      checkIn,
      checkOut,
    );
    const nights = enumerateNights(checkIn, checkOut);
    return rooms.filter(
      (room) =>
        this.roomIsFree(room._id, nights, maps) &&
        (guests === undefined || room.maxAdults + room.maxChildren >= guests),
    );
  }

  private addOneDay(date: string): string {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    parsed.setUTCDate(parsed.getUTCDate() + 1);
    return parsed.toISOString().slice(0, 10);
  }
}
