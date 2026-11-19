import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomInt } from 'node:crypto';
import { Connection, Model, Types } from 'mongoose';
import type { QueryFilter as FilterQuery } from 'mongoose';
import type { AuthUser } from '../shared/auth/auth-user';
import {
  BOOKING_REFERENCE_PREFIX,
  DEFAULT_HOLD_MINUTES,
  MAX_GUESTS_PER_BOOKING,
  MAX_STAY_NIGHTS,
} from '../shared/constants';
import { PaginatedResult, paginate } from '../shared/dto/pagination-query.dto';
import {
  addDaysISO,
  assertValidStay,
  differenceInCalendarDays,
  todayISO,
} from '../shared/utils/date.util';
import { envFlag, envInt } from '../shared/utils/env.util';
import { toObjectId } from '../shared/utils/object-id.util';
import { isDuplicateKeyError, runInTransaction } from '../shared/utils/transaction.util';
import { AvailabilityService } from './availability.service';
import {
  AdminBookingsQueryDto,
  AttachPaymentIntentDto,
  CancelHotelBookingDto,
  ConfirmHotelBookingDto,
  CreateHotelBookingDto,
  HotelReservationsQueryDto,
  ListMyBookingsQueryDto,
  UpdateRefundStatusDto,
} from './dto/booking.dto';
import {
  CancellationQuoteResponseDto,
  HotelBookingResponseDto,
} from './dto/responses.dto';
import {
  calculateReservationTotal,
  calculateRoomSubtotal,
} from './domain/pricing.util';
import { calculateCancellationRefund } from './domain/refund-policy.util';
import { assertGuestsFitRoom } from './domain/occupancy.util';
import { assertTransition } from './domain/booking-state.util';
import { HotelsService } from './hotels.service';
import { HOTEL_NOTIFICATION_SERVICE } from './integrations/notification.port';
import type { NotificationPort } from './integrations/notification.port';
import { PAYMENT_GATEWAY } from './integrations/payment-gateway.port';
import type { PaymentGatewayPort } from './integrations/payment-gateway.port';
import { toBookingResponse } from './mappers/response.mapper';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import {
  BookedRoom,
  CancelledBy,
  HotelBooking,
  HotelBookingDocument,
  HotelBookingStatus,
  RefundStatus,
} from './schemas/hotel-booking.schema';
import { Room, RoomDocument } from './schemas/room.schema';

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class HotelBookingsService implements OnModuleInit {
  private readonly logger = new Logger(HotelBookingsService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookingModel: Model<HotelBookingDocument>,
    @InjectModel(Hotel.name) private readonly hotelModel: Model<HotelDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly availability: AvailabilityService,
    private readonly hotels: HotelsService,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGatewayPort,
    @Inject(HOTEL_NOTIFICATION_SERVICE)
    private readonly notifications: NotificationPort,
  ) {}

  /** Wait for the unique reservation-reference index before serving requests. */
  async onModuleInit(): Promise<void> {
    await this.bookingModel.init();
  }

  // -------------------------------------------------------------------------
  // HTL-16 / HTL-18: atomic 10-minute hold for one or more rooms
  // -------------------------------------------------------------------------

  async createHold(
    dto: CreateHotelBookingDto,
    user: AuthUser,
  ): Promise<HotelBookingResponseDto> {
    const hotel = await this.hotels.getHotelOrThrow(toObjectId(dto.hotelId, 'hotelId'));
    if (!hotel.isActive) {
      throw new ConflictException('This hotel is not available for booking.');
    }

    const stay = assertValidStay(dto.checkIn, dto.checkOut, { maxNights: MAX_STAY_NIGHTS });
    const selections = dto.rooms;
    const roomIds = selections.map((selection) => toObjectId(selection.roomId, 'roomId'));
    if (new Set(roomIds.map((id) => id.toString())).size !== roomIds.length) {
      throw new BadRequestException('The same room cannot be selected twice in one reservation.');
    }

    const rooms = await this.roomModel
      .find({ _id: { $in: roomIds }, hotelId: hotel._id })
      .exec();
    if (rooms.length !== roomIds.length) {
      throw new BadRequestException('One or more selected rooms do not belong to this hotel.');
    }

    const roomById = new Map(rooms.map((room) => [room._id.toString(), room]));
    const currency = this.hotels.platformCurrency();
    let guestCount = 0;

    const bookedRooms: BookedRoom[] = selections.map((selection) => {
      const room = roomById.get(selection.roomId);
      if (!room) {
        throw new BadRequestException('One or more selected rooms do not belong to this hotel.');
      }
      if (!room.isActive) {
        throw new ConflictException(`Room ${room.roomNumber} is not open for booking.`);
      }
      if (room.currency !== currency) {
        throw new ConflictException(
          `Room ${room.roomNumber} is priced in ${room.currency}, but the platform currency is ${currency}.`,
        );
      }

      assertGuestsFitRoom(
        selection.guests,
        room,
        room.roomNumber,
        hotel.policies.childrenAllowed,
      );
      guestCount += selection.guests.length;

      return {
        roomId: room._id,
        roomNumber: room.roomNumber,
        roomName: room.name,
        pricePerNightCents: room.basePricePerNightCents,
        nights: stay.nights,
        guests: selection.guests.map((guest) => ({
          firstName: guest.firstName,
          lastName: guest.lastName,
          age: guest.age ?? null,
        })),
        subtotalCents: calculateRoomSubtotal(room.basePricePerNightCents, stay.nights),
        ...(selection.specialRequests ? { specialRequests: selection.specialRequests } : {}),
      };
    });

    if (guestCount > MAX_GUESTS_PER_BOOKING) {
      throw new BadRequestException(
        `A single reservation cannot contain more than ${MAX_GUESTS_PER_BOOKING} guests.`,
      );
    }

    const totalAmountCents = calculateReservationTotal(bookedRooms);
    const holdMinutes = envInt('HOTEL_HOLD_MINUTES', DEFAULT_HOLD_MINUTES);
    const holdExpiresAt = new Date(Date.now() + holdMinutes * 60_000);

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const reference = this.generateReference();
      const bookingId = new Types.ObjectId();

      try {
        let created: HotelBookingDocument | null = null;
        await runInTransaction(this.connection, async (session) => {
          const maps = await this.availability.getMaps(
            roomIds,
            stay.checkIn,
            stay.checkOut,
            session,
          );
          this.availability.assertMapsAllowStay(rooms, stay.checkIn, stay.checkOut, maps);

          const [document] = await this.bookingModel.create(
            [
              {
                _id: bookingId,
                reference,
                userId: toObjectId(user.id, 'user id'),
                hotelId: hotel._id,
                hotelName: hotel.name,
                rooms: bookedRooms,
                checkIn: stay.checkIn,
                checkOut: stay.checkOut,
                nights: stay.nights,
                guestCount,
                totalAmountCents,
                currency,
                status: HotelBookingStatus.HELD,
                holdExpiresAt,
                policiesAcceptedAt: null,
                paymentId: null,
                policySnapshot: {
                  checkInTime: hotel.policies.checkInTime,
                  checkOutTime: hotel.policies.checkOutTime,
                  cancellationTiers: hotel.policies.cancellationTiers.map((tier) => ({
                    minDaysBeforeCheckIn: tier.minDaysBeforeCheckIn,
                    refundPercent: tier.refundPercent,
                    ...(tier.description ? { description: tier.description } : {}),
                  })),
                  capturedAt: new Date(),
                },
                ...(dto.notes ? { notes: dto.notes } : {}),
              },
            ],
            { session },
          );

          await this.availability.acquireLocks({
            bookingId: document._id,
            hotelId: hotel._id,
            rooms,
            checkIn: stay.checkIn,
            checkOut: stay.checkOut,
            expiresAt: holdExpiresAt,
            session,
          });

          created = document;
        });

        if (!created) {
          throw new ConflictException('The reservation hold could not be created. Please retry.');
        }

        return toBookingResponse(created, user);
      } catch (error) {
        lastError = error;
        if (isDuplicateKeyError(error)) {
          if (this.isDuplicateReference(error)) {
            continue;
          }
          throw new ConflictException(
            'One or more selected rooms are no longer available for these dates.',
          );
        }
        throw error;
      }
    }

    this.logger.error(`Could not allocate a unique reservation reference: ${String(lastError)}`);
    throw new ConflictException('Could not create the reservation. Please retry.');
  }

  // -------------------------------------------------------------------------
  // PAY-02: policy acceptance is required before payment confirmation
  // -------------------------------------------------------------------------

  async acceptPolicies(
    id: Types.ObjectId,
    user: AuthUser,
  ): Promise<HotelBookingResponseDto> {
    const booking = await this.getBookingOrThrow(id);
    if (booking.userId.toString() !== user.id) {
      throw new ForbiddenException('Only the owner can accept the policies of this reservation.');
    }
    if (booking.status !== HotelBookingStatus.HELD) {
      throw new ConflictException('Policies can only be accepted while the reservation is on hold.');
    }
    if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() <= Date.now()) {
      throw new ConflictException('The reservation hold has expired. Please start a new booking.');
    }

    if (!booking.policiesAcceptedAt) {
      booking.policiesAcceptedAt = new Date();
      await booking.save();
    }
    return toBookingResponse(booking, user);
  }

  /**
   * INTEGRATION (Member 4): Member 4's generic
   * POST /api/bookings/hotel/:id/accept-policies should delegate here.
   */
  async recordPolicyAcceptance(id: Types.ObjectId, acceptedAt = new Date()): Promise<void> {
    const booking = await this.getBookingOrThrow(id);
    if (booking.status !== HotelBookingStatus.HELD || booking.policiesAcceptedAt) {
      return;
    }
    booking.policiesAcceptedAt = acceptedAt;
    await booking.save();
  }

  async attachPaymentIntent(
    id: Types.ObjectId,
    dto: AttachPaymentIntentDto,
  ): Promise<HotelBookingResponseDto> {
    const booking = await this.getBookingOrThrow(id);
    if (
      booking.status !== HotelBookingStatus.HELD &&
      booking.status !== HotelBookingStatus.CONFIRMED
    ) {
      throw new ConflictException('A payment intent can only be attached to an active reservation.');
    }
    booking.paymentId = dto.paymentIntentId;
    await booking.save();
    return toBookingResponse(booking);
  }

  // -------------------------------------------------------------------------
  // HTL-19: confirmation only after Member 4 verified the payment
  // -------------------------------------------------------------------------

  async confirm(
    id: Types.ObjectId,
    dto: ConfirmHotelBookingDto = {},
  ): Promise<HotelBookingResponseDto> {
    const booking = await this.getBookingOrThrow(id);
    if (booking.status === HotelBookingStatus.CONFIRMED) {
      return toBookingResponse(booking);
    }
    if (booking.status !== HotelBookingStatus.HELD) {
      throw new ConflictException(
        `A reservation in status ${booking.status} cannot be confirmed.`,
      );
    }
    assertTransition(booking.status, HotelBookingStatus.CONFIRMED);

    if (envFlag('REQUIRE_POLICY_ACCEPTANCE', true) && !booking.policiesAcceptedAt) {
      throw new ConflictException(
        'The booking policies must be accepted before the payment can be confirmed.',
      );
    }

    const now = new Date();
    const updated = await runInTransaction(this.connection, async (session) => {
      const fresh = await this.bookingModel
        .findOneAndUpdate(
          {
            _id: booking._id,
            status: HotelBookingStatus.HELD,
            holdExpiresAt: { $gt: now },
          },
          {
            $set: {
              status: HotelBookingStatus.CONFIRMED,
              confirmedAt: now,
              holdExpiresAt: null,
              ...(dto.paymentId ? { paymentId: dto.paymentId } : {}),
            },
          },
          { new: true, session },
        )
        .exec();

      if (fresh) {
        await this.availability.markConfirmed(fresh._id, session);
      }
      return fresh;
    });

    if (!updated) {
      const latest = await this.getBookingOrThrow(booking._id);
      if (latest.status === HotelBookingStatus.CONFIRMED) {
        return toBookingResponse(latest);
      }
      if (latest.status === HotelBookingStatus.HELD) {
        await this.expireHold(latest._id);
        throw new ConflictException('The reservation hold expired before payment was confirmed.');
      }
      throw new ConflictException(
        `The reservation is ${latest.status} and cannot be confirmed.`,
      );
    }

    await this.notify({
      userId: updated.userId.toString(),
      type: 'HOTEL_BOOKING_CONFIRMED',
      title: 'Reservation confirmed',
      message: `Your reservation ${updated.reference} at ${updated.hotelName} is confirmed for ${updated.checkIn} to ${updated.checkOut}.`,
      data: { bookingId: updated._id.toString(), reference: updated.reference },
    });

    return toBookingResponse(updated);
  }

  // -------------------------------------------------------------------------
  // HTL-20 / HTL-21: booking history, access control and cancellation
  // -------------------------------------------------------------------------

  async listMine(
    user: AuthUser,
    query: ListMyBookingsQueryDto,
  ): Promise<PaginatedResult<HotelBookingResponseDto>> {
    const filter: FilterQuery<HotelBookingDocument> = { userId: toObjectId(user.id) };
    this.applyListFilters(filter, query);
    return this.paginateBookings(filter, query, user);
  }

  /**
   * HTL-20: the user's reservations grouped as Upcoming, Past and Cancelled
   * (same rules as flight bookings): Upcoming = Confirmed with the stay not
   * yet finished; Past = Completed, or Confirmed after check-out; Cancelled.
   * Unpaid holds and expired holds are not reservations yet and are left out.
   */
  async groupedForUser(user: AuthUser, today = todayISO()) {
    const bookings = await this.bookingModel
      .find({
        userId: toObjectId(user.id),
        status: {
          $in: [
            HotelBookingStatus.CONFIRMED,
            HotelBookingStatus.COMPLETED,
            HotelBookingStatus.CANCELLED,
          ],
        },
      })
      .sort({ checkIn: 1, createdAt: 1 })
      .exec();
    const groups = {
      upcoming: [] as HotelBookingResponseDto[],
      past: [] as HotelBookingResponseDto[],
      cancelled: [] as HotelBookingResponseDto[],
    };
    for (const booking of bookings) {
      const item = toBookingResponse(booking, user);
      if (booking.status === HotelBookingStatus.CANCELLED) groups.cancelled.push(item);
      else if (booking.status === HotelBookingStatus.CONFIRMED && booking.checkOut > today)
        groups.upcoming.push(item);
      else groups.past.push(item);
    }
    // Upcoming soonest first; past and cancelled most recent first.
    groups.past.reverse();
    groups.cancelled.reverse();
    return groups;
  }

  /** HTL-22: hotel moderator reservation list. */
  async listForHotel(
    hotelId: Types.ObjectId,
    query: HotelReservationsQueryDto,
    user: AuthUser,
  ): Promise<PaginatedResult<HotelBookingResponseDto>> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    this.hotels.assertCanManage(user, hotel);

    const filter: FilterQuery<HotelBookingDocument> = { hotelId: hotel._id };
    this.applyListFilters(filter, query);

    if (query.reference?.trim()) {
      filter.reference = {
        $regex: `^${this.escapeRegex(query.reference.trim())}$`,
        $options: 'i',
      };
    }
    if (query.guestName?.trim()) {
      const regex = { $regex: this.escapeRegex(query.guestName.trim()), $options: 'i' };
      filter.$or = [
        { 'rooms.guests.firstName': regex },
        { 'rooms.guests.lastName': regex },
      ];
    }

    return this.paginateBookings(filter, query, user);
  }

  /** ACC-17: administrator booking inspection (Member 1 calls this service). */
  async searchAll(
    user: AuthUser,
    query: AdminBookingsQueryDto,
  ): Promise<PaginatedResult<HotelBookingResponseDto>> {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Only an administrator can inspect all reservations.');
    }

    const filter: FilterQuery<HotelBookingDocument> = {};
    if (query.hotelId) filter.hotelId = toObjectId(query.hotelId, 'hotelId');
    if (query.userId) filter.userId = toObjectId(query.userId, 'userId');
    if (query.reference?.trim()) {
      filter.reference = {
        $regex: `^${this.escapeRegex(query.reference.trim())}$`,
        $options: 'i',
      };
    }
    this.applyListFilters(filter, query);

    return this.paginateBookings(filter, query, user);
  }

  async getOne(id: Types.ObjectId, user: AuthUser): Promise<HotelBookingResponseDto> {
    const booking = await this.getBookingOrThrow(id);
    await this.assertCanView(booking, user);
    return toBookingResponse(booking, user);
  }

  async quoteCancellation(
    id: Types.ObjectId,
    user: AuthUser,
  ): Promise<CancellationQuoteResponseDto> {
    const booking = await this.getBookingOrThrow(id);
    await this.assertCanView(booking, user);

    if (booking.status === HotelBookingStatus.HELD) {
      return {
        bookingId: booking._id.toString(),
        daysBeforeCheckIn: this.daysBeforeCheckIn(booking.checkIn),
        refundPercent: 0,
        refundAmountCents: 0,
        totalAmountCents: booking.totalAmountCents,
        currency: booking.currency,
      };
    }
    if (booking.status !== HotelBookingStatus.CONFIRMED) {
      throw new ConflictException('A refund quote is only available for a held or confirmed reservation.');
    }
    if (booking.checkIn <= todayISO()) {
      throw new ConflictException('A stay that already started cannot be cancelled online.');
    }

    const daysBefore = this.daysBeforeCheckIn(booking.checkIn);
    const refund = calculateCancellationRefund(
      booking.totalAmountCents,
      booking.policySnapshot.cancellationTiers,
      daysBefore,
    );

    return {
      bookingId: booking._id.toString(),
      daysBeforeCheckIn: daysBefore,
      refundPercent: refund.percent,
      refundAmountCents: refund.amountCents,
      totalAmountCents: booking.totalAmountCents,
      currency: booking.currency,
      ...(refund.tier?.description ? { tierDescription: refund.tier.description } : {}),
    };
  }

  async cancel(
    id: Types.ObjectId,
    user: AuthUser,
    dto: CancelHotelBookingDto,
  ): Promise<HotelBookingResponseDto> {
    const booking = await this.getBookingOrThrow(id);
    const isOwner = booking.userId.toString() === user.id;
    if (!isOwner && user.role !== 'ADMIN') {
      throw new ForbiddenException('You can only cancel your own reservations.');
    }

    if (booking.status === HotelBookingStatus.CANCELLED) {
      return toBookingResponse(booking, user);
    }
    if (
      booking.status !== HotelBookingStatus.HELD &&
      booking.status !== HotelBookingStatus.CONFIRMED
    ) {
      throw new ConflictException(`A reservation in status ${booking.status} cannot be cancelled.`);
    }
    if (
      booking.status === HotelBookingStatus.CONFIRMED &&
      booking.checkIn <= todayISO()
    ) {
      throw new ConflictException('A stay that already started cannot be cancelled online.');
    }

    assertTransition(booking.status, HotelBookingStatus.CANCELLED);

    const cancelled = await this.performCancellation(
      booking,
      isOwner ? CancelledBy.USER : CancelledBy.ADMIN,
      dto.reason,
      false,
    );

    return toBookingResponse(cancelled, user);
  }

  /**
   * PAY-16: provider-initiated cancellations are refunded in full.
   * Member 1 / Member 4 call this when a hotel or administrator cancels.
   */
  async cancelByProvider(
    id: Types.ObjectId,
    reason: string,
  ): Promise<HotelBookingResponseDto> {
    const booking = await this.getBookingOrThrow(id);
    if (booking.status === HotelBookingStatus.CANCELLED) {
      return toBookingResponse(booking);
    }
    if (
      booking.status !== HotelBookingStatus.HELD &&
      booking.status !== HotelBookingStatus.CONFIRMED
    ) {
      throw new ConflictException(`A reservation in status ${booking.status} cannot be cancelled.`);
    }

    const cancelled = await this.performCancellation(
      booking,
      CancelledBy.ADMIN,
      reason,
      true,
    );
    return toBookingResponse(cancelled);
  }

  // -------------------------------------------------------------------------
  // PAY-17: refund status reconciliation for Member 4's webhook
  // -------------------------------------------------------------------------

  async updateRefundStatus(
    id: Types.ObjectId,
    dto: UpdateRefundStatusDto,
  ): Promise<HotelBookingResponseDto> {
    const booking = await this.getBookingOrThrow(id);
    if (!booking.cancellation) {
      throw new ConflictException('This reservation has no cancellation refund to update.');
    }

    booking.cancellation.refund.status = dto.status as RefundStatus;
    if (dto.providerRefundId !== undefined) {
      booking.cancellation.refund.providerRefundId = dto.providerRefundId;
    }
    if (dto.status === 'REFUNDED') {
      booking.cancellation.refund.processedAt = new Date();
      booking.cancellation.refund.failureReason = null;
    }
    if (dto.status === 'FAILED') {
      booking.cancellation.refund.failureReason = dto.failureReason ?? 'Refund failed.';
    }
    await booking.save();

    return toBookingResponse(booking);
  }

  // -------------------------------------------------------------------------
  // HTL-22: automatic Completed status, hold expiry, lock cleanup
  // -------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_MINUTE)
  async expireHoldsJob(): Promise<void> {
    if (!envFlag('ENABLE_HOTEL_JOBS', true)) {
      return;
    }
    try {
      await this.expireHolds();
    } catch (error) {
      this.logger.error(`Hold expiry job failed: ${this.describeError(error)}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async completePastStaysJob(): Promise<void> {
    if (!envFlag('ENABLE_HOTEL_JOBS', true)) {
      return;
    }
    try {
      await this.completePastStays();
      await this.purgeLocks();
    } catch (error) {
      this.logger.error(`Stay completion job failed: ${this.describeError(error)}`);
    }
  }

  async expireHolds(): Promise<number> {
    const now = new Date();
    const candidates = await this.bookingModel
      .find({ status: HotelBookingStatus.HELD, holdExpiresAt: { $lte: now } })
      .limit(200)
      .exec();

    let expired = 0;
    for (const candidate of candidates) {
      const updated = await runInTransaction(this.connection, async (session) => {
        const fresh = await this.bookingModel
          .findOneAndUpdate(
            {
              _id: candidate._id,
              status: HotelBookingStatus.HELD,
              holdExpiresAt: { $lte: now },
            },
            {
              $set: {
                status: HotelBookingStatus.EXPIRED,
                expiredAt: now,
                holdExpiresAt: null,
              },
            },
            { new: true, session },
          )
          .exec();

        if (fresh) {
          await this.availability.releaseLocks(fresh._id, session);
        }
        return fresh;
      });

      if (!updated) {
        continue;
      }
      expired += 1;

      if (updated.paymentId) {
        try {
          await this.payments.cancelPaymentIntent({
            paymentIntentId: updated.paymentId,
            bookingId: updated._id.toString(),
          });
        } catch (error) {
          this.logger.warn(
            `Could not cancel PaymentIntent for expired hold ${updated.reference}: ${this.describeError(error)}`,
          );
        }
      }

      await this.notify({
        userId: updated.userId.toString(),
        type: 'HOTEL_BOOKING_EXPIRED',
        title: 'Reservation hold expired',
        message: `The 10-minute hold for ${updated.hotelName} (${updated.checkIn} to ${updated.checkOut}) expired before payment was completed.`,
        data: { bookingId: updated._id.toString() },
      });
    }

    return expired;
  }

  async completePastStays(): Promise<number> {
    const today = todayISO();
    const candidates = await this.bookingModel
      .find({ status: HotelBookingStatus.CONFIRMED, checkOut: { $lt: today } })
      .limit(200)
      .exec();

    let completed = 0;
    for (const candidate of candidates) {
      const updated = await this.bookingModel
        .findOneAndUpdate(
          { _id: candidate._id, status: HotelBookingStatus.CONFIRMED },
          { $set: { status: HotelBookingStatus.COMPLETED, completedAt: new Date() } },
          { new: true },
        )
        .exec();

      if (!updated) {
        continue;
      }
      completed += 1;

      await this.notify({
        userId: updated.userId.toString(),
        type: 'HOTEL_STAY_COMPLETED',
        title: 'How was your stay?',
        message: `Your stay at ${updated.hotelName} is complete. You can now review reservation ${updated.reference}.`,
        data: { bookingId: updated._id.toString(), reference: updated.reference },
      });
    }

    return completed;
  }

  async purgeLocks(): Promise<number> {
    const expired = await this.availability.purgeExpiredLocks();
    const old = await this.availability.purgeOldLocks(addDaysISO(todayISO(), -1));
    return expired + old;
  }

  /** Used by the stand-alone sandbox and by administrators for demos. */
  async runMaintenance(): Promise<{
    expiredHolds: number;
    completedStays: number;
    purgedLocks: number;
  }> {
    const expiredHolds = await this.expireHolds();
    const completedStays = await this.completePastStays();
    const purgedLocks = await this.purgeLocks();
    return { expiredHolds, completedStays, purgedLocks };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async getBookingOrThrow(id: Types.ObjectId): Promise<HotelBookingDocument> {
    const booking = await this.bookingModel.findById(id).exec();
    if (!booking) {
      throw new NotFoundException('Reservation not found.');
    }
    return booking;
  }

  private async assertCanView(booking: HotelBookingDocument, user: AuthUser): Promise<void> {
    if (booking.userId.toString() === user.id || user.role === 'ADMIN') {
      return;
    }
    if (user.role === 'HOTEL_MODERATOR') {
      const hotel = await this.hotels.getHotelOrThrow(booking.hotelId);
      if (this.hotels.canManage(user, hotel)) {
        return;
      }
    }
    throw new ForbiddenException('You do not have access to this reservation.');
  }

  private async performCancellation(
    booking: HotelBookingDocument,
    cancelledBy: CancelledBy,
    reason: string | undefined,
    forceFullRefund: boolean,
  ): Promise<HotelBookingDocument> {
    const daysBefore = this.daysBeforeCheckIn(booking.checkIn);
    const refund =
      booking.status === HotelBookingStatus.CONFIRMED
        ? forceFullRefund
          ? { percent: 100, amountCents: booking.totalAmountCents, tier: null }
          : calculateCancellationRefund(
              booking.totalAmountCents,
              booking.policySnapshot.cancellationTiers,
              daysBefore,
            )
        : { percent: 0, amountCents: 0, tier: null };

    const now = new Date();
    const refundStatus = refund.amountCents > 0 ? RefundStatus.PENDING : RefundStatus.NONE;

    const updated = await runInTransaction(this.connection, async (session) => {
      const fresh = await this.bookingModel
        .findOneAndUpdate(
          { _id: booking._id, status: booking.status },
          {
            $set: {
              status: HotelBookingStatus.CANCELLED,
              holdExpiresAt: null,
              cancellation: {
                cancelledBy,
                ...(reason ? { reason } : {}),
                cancelledAt: now,
                daysBeforeCheckIn: daysBefore,
                refund: {
                  amountCents: refund.amountCents,
                  percent: refund.percent,
                  status: refundStatus,
                  providerRefundId: null,
                  requestedAt: refundStatus === RefundStatus.PENDING ? now : null,
                  processedAt: null,
                  failureReason: null,
                },
              },
            },
          },
          { new: true, session },
        )
        .exec();

      if (fresh) {
        await this.availability.releaseLocks(fresh._id, session);
      }
      return fresh;
    });

    if (!updated) {
      const latest = await this.getBookingOrThrow(booking._id);
      if (latest.status === HotelBookingStatus.CANCELLED) {
        return latest;
      }
      throw new ConflictException(
        'The reservation changed state while it was being cancelled. Refresh and retry.',
      );
    }

    if (refund.amountCents > 0) {
      await this.requestRefund(updated, reason ?? 'Guest cancelled the reservation');
    }

    await this.notify({
      userId: updated.userId.toString(),
      type: 'HOTEL_BOOKING_CANCELLED',
      title: 'Reservation cancelled',
      message: `Reservation ${updated.reference} at ${updated.hotelName} was cancelled. Refund: ${refund.percent}% (${refund.amountCents} ${updated.currency} minor units).`,
      data: { bookingId: updated._id.toString(), reference: updated.reference },
    });

    await this.notifyModerator(updated, {
      type: 'HOTEL_BOOKING_CANCELLED',
      title: 'Reservation cancelled',
      message: `Reservation ${updated.reference} for ${updated.hotelName} was cancelled.`,
    });

    return (await this.bookingModel.findById(updated._id).exec()) ?? updated;
  }

  private async requestRefund(
    booking: HotelBookingDocument,
    reason: string,
  ): Promise<void> {
    const refund = booking.cancellation?.refund;
    if (!refund) {
      return;
    }

    try {
      const result = await this.payments.refundHotelBooking({
        bookingId: booking._id.toString(),
        bookingReference: booking.reference,
        userId: booking.userId.toString(),
        amountCents: refund.amountCents,
        currency: booking.currency,
        reason,
        providerInitiated: booking.cancellation?.cancelledBy !== CancelledBy.USER,
        paymentId: booking.paymentId ?? null,
      });

      await this.bookingModel.updateOne(
        { _id: booking._id },
        {
          $set: {
            'cancellation.refund.status': result.status,
            'cancellation.refund.providerRefundId': result.providerRefundId ?? null,
            'cancellation.refund.processedAt': result.status === 'REFUNDED' ? new Date() : null,
            'cancellation.refund.failureReason': result.failureReason ?? null,
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Refund request failed for ${booking.reference}: ${this.describeError(error)}`,
      );
      await this.bookingModel.updateOne(
        { _id: booking._id },
        {
          $set: {
            'cancellation.refund.status': RefundStatus.FAILED,
            'cancellation.refund.failureReason': this.describeError(error).slice(0, 500),
          },
        },
      );
    }
  }

  async expireHold(bookingId: Types.ObjectId): Promise<boolean> {
    const now = new Date();
    const updated = await runInTransaction(this.connection, async (session) => {
      const fresh = await this.bookingModel
        .findOneAndUpdate(
          { _id: bookingId, status: HotelBookingStatus.HELD, holdExpiresAt: { $lte: now } },
          {
            $set: {
              status: HotelBookingStatus.EXPIRED,
              expiredAt: now,
              holdExpiresAt: null,
            },
          },
          { new: true, session },
        )
        .exec();

      if (fresh) {
        await this.availability.releaseLocks(fresh._id, session);
      }
      return fresh;
    });

    if (updated) {
      await this.notify({
        userId: updated.userId.toString(),
        type: 'HOTEL_BOOKING_EXPIRED',
        title: 'Reservation hold expired',
        message: `The hold for ${updated.hotelName} expired before payment was completed.`,
        data: { bookingId: updated._id.toString() },
      });
    }
    return !!updated;
  }

  private async paginateBookings(
    filter: FilterQuery<HotelBookingDocument>,
    query: ListMyBookingsQueryDto,
    viewer: AuthUser,
  ): Promise<PaginatedResult<HotelBookingResponseDto>> {
    const total = await this.bookingModel.countDocuments(filter).exec();
    const bookings = await this.bookingModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(query.skip)
      .limit(query.limit)
      .exec();

    return paginate(
      bookings.map((booking) => toBookingResponse(booking, viewer)),
      total,
      query.page,
      query.limit,
    );
  }

  private applyListFilters(
    filter: FilterQuery<HotelBookingDocument>,
    query: ListMyBookingsQueryDto,
  ): void {
    if (query.status) {
      filter.status = query.status;
    }
    if (query.from || query.to) {
      const range: Record<string, string> = {};
      if (query.from) range.$gte = query.from;
      if (query.to) range.$lte = query.to;
      filter.checkIn = range;
    }
  }

  private daysBeforeCheckIn(checkIn: string): number {
    return Math.max(differenceInCalendarDays(todayISO(), checkIn), 0);
  }

  private generateReference(): string {
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
    }
    return `${BOOKING_REFERENCE_PREFIX}-${code}`;
  }

  private isDuplicateReference(error: unknown): boolean {
    if (!isDuplicateKeyError(error)) {
      return false;
    }
    const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern;
    return !!keyPattern && 'reference' in keyPattern;
  }

  private async notify(notification: Parameters<NotificationPort['send']>[0]): Promise<void> {
    try {
      await this.notifications.send(notification);
    } catch (error) {
      this.logger.warn(`Notification failed: ${this.describeError(error)}`);
    }
  }

  private async notifyModerator(
    booking: HotelBookingDocument,
    notification: Pick<Parameters<NotificationPort['send']>[0], 'type' | 'title' | 'message'>,
  ): Promise<void> {
    try {
      const hotel = await this.hotelModel.findById(booking.hotelId).exec();
      if (!hotel?.moderatorId) {
        return;
      }
      await this.notify({
        userId: hotel.moderatorId.toString(),
        ...notification,
        data: { bookingId: booking._id.toString(), reference: booking.reference },
      });
    } catch (error) {
      this.logger.warn(`Moderator notification failed: ${this.describeError(error)}`);
    }
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
