import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Connection, Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { notificationRecord } from '../common/notification-record';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { AccountStatus } from '../auth/constants/account-status';
import { BCRYPT_ROUNDS } from '../auth/constants/auth.constants';
import { MODERATOR_ROLES, UserRole } from '../auth/constants/roles';
import {
  RefreshSession,
  RefreshSessionDocument,
} from '../auth/schemas/refresh-session.schema';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { toSafeUser } from '../auth/utils/safe-user';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ListAccountsDto } from './dto/list-accounts.dto';
import { ListAdminBookingsDto } from './dto/list-bookings.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(RefreshSession.name)
    private readonly refreshSessionModel: Model<RefreshSessionDocument>,
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<AirlineDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly mail: MailService,
  ) {}

  /**
   * GEN-07: record an admin action in the shared audit log (the same
   * `audit_logs` collection and shape that GET /api/admin/audit-logs reads).
   */
  async audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const now = new Date();
    await this.connection.collection('audit_logs').insertOne({
      actorId: new Types.ObjectId(actorId),
      action,
      targetType,
      targetId: new Types.ObjectId(targetId),
      details,
      createdAt: now,
      updatedAt: now,
    });
  }

  async createModerator(dto: CreateModeratorDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.userModel.findOne({ email });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    await this.assertProviderExists(dto.providerType, dto.providerId);

    const role =
      dto.providerType === 'airline'
        ? UserRole.AIRLINE_MODERATOR
        : UserRole.HOTEL_MODERATOR;

    const passwordHash = await bcrypt.hash(
      dto.temporaryPassword,
      BCRYPT_ROUNDS,
    );

    const user = await this.userModel.create({
      name: dto.name.trim(),
      email,
      passwordHash,
      role,
      status: AccountStatus.ACTIVE,
      acceptedTerms: true,
      acceptedPrivacyPolicy: true,
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockUntil: null,
      phone: null,
      preferredCurrency: 'USD',
      providerType: dto.providerType,
      providerId: new Types.ObjectId(dto.providerId),
    });

    // GEN-01-B (optional): email the invitation. The temporary password is
    // never emailed; the admin hands it over separately.
    await this.mail.send({
      to: user.email,
      subject: 'You have been invited as a moderator',
      text:
        `Hello ${user.name},\n\n` +
        `An administrator created a ${dto.providerType} moderator account for you on the Travel Planning Platform.\n` +
        `Log in at ${this.mail.publicUrl()}/api/auth/login with this email and the temporary password your administrator gives you. ` +
        'You will be asked to choose a new password on first login.',
    });

    return {
      message: 'Moderator created successfully',
      user: toSafeUser(user),
      temporaryPassword: dto.temporaryPassword,
    };
  }

  async listAccounts(query: ListAccountsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter: Record<string, unknown> = {};

    if (query.role) {
      filter.role = query.role;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.search?.trim()) {
      const term = query.search.trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
      ];
    }
    if (query.registeredFrom || query.registeredTo) {
      const createdAt: { $gte?: Date; $lte?: Date } = {};
      if (query.registeredFrom) {
        createdAt.$gte = new Date(query.registeredFrom);
      }
      if (query.registeredTo) {
        const end = new Date(query.registeredTo);
        end.setHours(23, 59, 59, 999);
        createdAt.$lte = end;
      }
      filter.createdAt = createdAt;
    }

    const [total, users] = await Promise.all([
      this.userModel.countDocuments(filter),
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
    ]);

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
      accounts: users.map((user) => toSafeUser(user)),
    };
  }

  async suspendAccount(id: string) {
    const user = await this.findManagedAccount(id);
    if (user.status === AccountStatus.SUSPENDED) {
      throw new BadRequestException('Account is already suspended');
    }

    user.status = AccountStatus.SUSPENDED;
    await user.save();

    await this.refreshSessionModel.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    await this.notifyUsers(
      [user._id.toString()],
      'account.suspended',
      'Account suspended',
      'Your account has been suspended.',
      `account:suspended:${randomUUID()}`,
    );

    return {
      message: 'Account suspended successfully',
      user: toSafeUser(user),
    };
  }

  async reactivateAccount(id: string) {
    const user = await this.findManagedAccount(id);
    if (user.status === AccountStatus.ACTIVE) {
      throw new BadRequestException('Account is already active');
    }
    if (user.status === AccountStatus.DEACTIVATED) {
      throw new BadRequestException(
        'Deactivated accounts cannot be reactivated through suspension controls',
      );
    }

    user.status = AccountStatus.ACTIVE;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    return {
      message: 'Account reactivated successfully',
      user: toSafeUser(user),
    };
  }

  async setProviderActive(
    type: 'airline' | 'hotel',
    id: string,
    isActive: boolean,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid provider id');
    }

    if (type === 'airline') {
      const airline = await this.airlineModel.findById(id);
      if (!airline) {
        throw new NotFoundException('Airline not found');
      }
      airline.isActive = isActive;
      await airline.save();
      if (!isActive)
        await this.notifyProviderAffected(
          'airline',
          airline._id.toString(),
          airline.name,
        );
      return {
        message: isActive
          ? 'Airline reactivated successfully'
          : 'Airline deactivated successfully',
        provider: {
          type: 'airline',
          id: airline._id.toString(),
          code: airline.code,
          name: airline.name,
          isActive: airline.isActive,
        },
        note: isActive
          ? undefined
          : 'Listings are hidden from search and new bookings are blocked. Existing Confirmed bookings remain valid.',
      };
    }

    const db = this.connection.db;
    if (!db) {
      throw new BadRequestException('Database connection unavailable');
    }

    const hotels = db.collection('hotels');
    const result = await hotels.findOneAndUpdate(
      { _id: new Types.ObjectId(id) },
      { $set: { isActive } },
      { returnDocument: 'after' },
    );

    if (!result) {
      throw new NotFoundException(
        'Hotel not found. Hotel provider management requires Member 3 hotel data.',
      );
    }

    const hotel = result as {
      _id: Types.ObjectId;
      name?: string;
      isActive?: boolean;
    };
    if (!isActive)
      await this.notifyProviderAffected(
        'hotel',
        hotel._id.toString(),
        hotel.name ?? 'Hotel',
      );

    return {
      message: isActive
        ? 'Hotel reactivated successfully'
        : 'Hotel deactivated successfully',
      provider: {
        type: 'hotel',
        id: hotel._id.toString(),
        name: hotel.name ?? null,
        isActive: hotel.isActive ?? isActive,
      },
      note: isActive
        ? undefined
        : 'Listings are hidden from search and new bookings are blocked. Existing Confirmed bookings remain valid.',
    };
  }

  private async notifyProviderAffected(
    type: 'airline' | 'hotel',
    providerId: string,
    name: string,
  ) {
    const db = this.connection.db;
    if (!db) return;
    const oid = new Types.ObjectId(providerId);
    const moderators = await db
      .collection('users')
      .distinct('_id', { providerType: type, providerId: oid });
    let passengers: unknown[];
    if (type === 'airline') {
      const flights = await db
        .collection('flights')
        .distinct('_id', { airlineId: oid });
      passengers = flights.length
        ? await db.collection('bookings').distinct('userId', {
            status: 'Confirmed',
            $or: [
              { flightId: { $in: flights } },
              { returnFlightId: { $in: flights } },
            ],
          })
        : [];
    } else {
      passengers = await db.collection('hotel_bookings').distinct('userId', {
        hotelId: oid,
        status: 'CONFIRMED',
      });
    }
    const recipients = [...new Set([...moderators, ...passengers].map(String))];
    await this.notifyUsers(
      recipients,
      'provider.suspended',
      `${name} deactivated`,
      `${name} is no longer accepting new bookings. Existing confirmed bookings remain valid.`,
      `provider:${type}:${providerId}:deactivated:${randomUUID()}`,
    );
  }

  private async notifyUsers(
    recipients: string[],
    type: string,
    title: string,
    message: string,
    eventId: string,
  ) {
    const db = this.connection.db;
    if (!db || !recipients.length) return;
    const notifications = db.collection('notifications');
    await notifications.bulkWrite(
      recipients.map((recipientId) => {
        const record = notificationRecord({
          recipientId,
          eventId,
          type,
          title,
          message,
        });
        return {
          updateOne: {
            filter: {
              recipientId: record.recipientId,
              eventId: record.eventId,
            },
            update: { $setOnInsert: record },
            upsert: true,
          },
        };
      }),
    );
  }

  async listBookings(query: ListAdminBookingsDto) {
    const db = this.connection.db;
    if (!db) {
      return {
        page: query.page ?? 1,
        limit: query.limit ?? 10,
        total: 0,
        totalPages: 0,
        bookings: [],
      };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {};
      if (query.from) {
        dateFilter.$gte = new Date(query.from);
      }
      if (query.to) {
        const end = new Date(query.to);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
      filter.createdAt = dateFilter;
    }

    const flightPipeline = [
      { $match: filter },
      {
        $lookup: {
          from: 'flights',
          localField: 'flightId',
          foreignField: '_id',
          as: 'flight',
        },
      },
      { $set: { flight: { $first: '$flight' } } },
      {
        $project: {
          _id: 1,
          reference: 1,
          type: { $literal: 'flight' },
          userId: 1,
          providerId: '$flight.airlineId',
          createdAt: 1,
          departureDate: '$flight.departureTimeUtc',
          amount: '$totalPrice',
          currency: {
            $literal: (process.env.PLATFORM_CURRENCY ?? 'USD').toUpperCase(),
          },
          status: 1,
        },
      },
    ];
    const hotelPipeline = [
      { $match: filter },
      {
        $project: {
          _id: 1,
          reference: 1,
          type: { $literal: 'hotel' },
          userId: 1,
          providerId: '$hotelId',
          createdAt: 1,
          checkInDate: '$checkIn',
          checkOutDate: '$checkOut',
          amount: { $divide: ['$totalAmountCents', 100] },
          currency: 1,
          status: 1,
        },
      },
    ];
    const source = query.type === 'hotel' ? 'hotel_bookings' : 'bookings';
    const pipeline: Record<string, unknown>[] =
      query.type === 'hotel' ? [...hotelPipeline] : [...flightPipeline];
    if (!query.type)
      pipeline.push({
        $unionWith: { coll: 'hotel_bookings', pipeline: hotelPipeline },
      });
    pipeline.push(
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        },
      },
    );
    const result = await db
      .collection(source)
      .aggregate<{
        metadata: Array<{ total: number }>;
        items: Array<Record<string, unknown>>;
      }>(pipeline)
      .next();
    const total = result?.metadata[0]?.total ?? 0;
    const rows = result?.items ?? [];

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
      bookings: rows.map((row) => this.mapBooking(row)),
    };
  }

  async analytics(from: string, to: string) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(from ?? '') || !datePattern.test(to ?? '')) {
      throw new BadRequestException('from and to must be dates in YYYY-MM-DD format');
    }
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ||
        start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to ||
        start > end) {
      throw new BadRequestException('Invalid analytics date range');
    }
    const db = this.connection.db;
    if (!db) return { from, to, providers: [] };
    const providers = await db.collection('payments').aggregate([
      { $match: { status: 'Succeeded', succeededAt: { $gte: start, $lte: end }, duplicateRefundId: { $exists: false } } },
      { $lookup: { from: 'bookings', localField: 'bookingId', foreignField: '_id', as: 'flightBooking' } },
      { $lookup: { from: 'flight_changes', localField: 'bookingId', foreignField: '_id', as: 'flightChange' } },
      { $lookup: { from: 'hotel_bookings', localField: 'bookingId', foreignField: '_id', as: 'hotelBooking' } },
      { $set: { flightBooking: { $first: '$flightBooking' }, flightChange: { $first: '$flightChange' }, hotelBooking: { $first: '$hotelBooking' } } },
      { $lookup: { from: 'flights', localField: 'flightBooking.flightId', foreignField: '_id', as: 'flight' } },
      { $lookup: { from: 'flights', localField: 'flightChange.newFlightId', foreignField: '_id', as: 'changeFlight' } },
      { $set: { flight: { $first: '$flight' } } },
      { $set: { changeFlight: { $first: '$changeFlight' } } },
      { $set: { providerId: { $switch: { branches: [
        { case: { $eq: ['$bookingType', 'hotel'] }, then: '$hotelBooking.hotelId' },
        { case: { $eq: ['$bookingType', 'flight_change'] }, then: '$changeFlight.airlineId' },
      ], default: '$flight.airlineId' } } } },
      { $match: { providerId: { $ne: null } } },
      { $lookup: { from: 'refunds', localField: '_id', foreignField: 'paymentId', pipeline: [{ $match: { status: 'Refunded' } }, { $project: { amount: 1 } }], as: 'refunds' } },
      { $set: { refundedMinor: { $sum: '$refunds.amount' } } },
      { $group: { _id: { type: { $cond: [{ $eq: ['$bookingType', 'flight_change'] }, 'flight', '$bookingType'] }, providerId: '$providerId', currency: '$currency' }, bookings: { $sum: { $cond: [{ $eq: ['$bookingType', 'flight_change'] }, 0, 1] } }, grossMinor: { $sum: '$amount' }, refundedMinor: { $sum: '$refundedMinor' } } },
      { $project: { _id: 0, type: '$_id.type', providerId: '$_id.providerId', currency: { $toUpper: '$_id.currency' }, bookings: 1, grossRevenue: { $divide: ['$grossMinor', 100] }, refunds: { $divide: ['$refundedMinor', 100] }, netRevenue: { $divide: [{ $subtract: ['$grossMinor', '$refundedMinor'] }, 100] } } },
      { $sort: { type: 1, providerId: 1, currency: 1 } },
    ]).toArray();
    return { from, to, providers: providers.map((provider) => ({ ...provider, providerId: String(provider.providerId) })) };
  }

  private mapBooking(row: Record<string, unknown>) {
    const id =
      row._id instanceof Types.ObjectId
        ? row._id.toString()
        : String(row._id ?? '');

    return {
      id,
      reference:
        (row.bookingReference as string) ?? (row.reference as string) ?? id,
      type:
        (row.type as string) ??
        (row.bookingType as string) ??
        (row.kind as string) ??
        null,
      userId: row.userId?.toString?.() ?? (row.user_id as string) ?? null,
      providerId:
        row.providerId?.toString?.() ??
        row.airlineId?.toString?.() ??
        row.hotelId?.toString?.() ??
        null,
      dates: {
        createdAt: row.createdAt ?? null,
        departureDate: row.departureDate ?? null,
        checkInDate: row.checkInDate ?? null,
        checkOutDate: row.checkOutDate ?? null,
      },
      amount:
        (row.totalAmount as number) ??
        (row.amount as number) ??
        (row.price as number) ??
        null,
      currency: (row.currency as string) ?? null,
      status: (row.status as string) ?? null,
    };
  }

  private async findManagedAccount(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid account id');
    }

    const user = await this.userModel.findById(id);
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException('Admin accounts cannot be suspended here');
    }

    if (
      user.role !== UserRole.USER &&
      !MODERATOR_ROLES.includes(user.role as UserRole)
    ) {
      throw new BadRequestException('Unsupported account role');
    }

    return user;
  }

  private async assertProviderExists(
    type: 'airline' | 'hotel',
    providerId: string,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(providerId)) {
      throw new BadRequestException('Invalid provider id');
    }

    if (type === 'airline') {
      const airline = await this.airlineModel.findById(providerId);
      if (!airline) {
        throw new NotFoundException('Airline not found');
      }
      if (airline.isActive === false) {
        throw new BadRequestException('Airline is deactivated');
      }
      return;
    }

    const db = this.connection.db;
    if (!db) {
      throw new BadRequestException('Database connection unavailable');
    }

    const hotel = await db
      .collection('hotels')
      .findOne({ _id: new Types.ObjectId(providerId) });
    if (!hotel) {
      throw new NotFoundException(
        'Hotel not found. Hotel moderators require Member 3 hotel data.',
      );
    }
  }
}
