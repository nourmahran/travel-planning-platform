import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Connection, Model, Types } from 'mongoose';
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
  ) {}

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
      notification:
        'Notification delivery will use Member 6 notification service when available.',
    };
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

    if (query.type) {
      filter.$or = [
        { type: query.type },
        { bookingType: query.type },
        { kind: query.type },
      ];
    }
    if (query.status) {
      filter.status = query.status;
    }
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
      filter.$and = [
        {
          $or: [
            { createdAt: dateFilter },
            { bookingDate: dateFilter },
            { departureDate: dateFilter },
            { checkInDate: dateFilter },
          ],
        },
      ];
    }

    const collection = db.collection('bookings');
    const total = await collection.countDocuments(filter);
    const rows = await collection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
      bookings: rows.map((row) => this.mapBooking(row)),
    };
  }

  private mapBooking(row: Record<string, unknown>) {
    const id =
      row._id instanceof Types.ObjectId
        ? row._id.toString()
        : String(row._id ?? '');

    return {
      id,
      reference:
        (row.bookingReference as string) ??
        (row.reference as string) ??
        id,
      type:
        (row.type as string) ??
        (row.bookingType as string) ??
        (row.kind as string) ??
        null,
      userId:
        row.userId?.toString?.() ??
        (row.user_id as string) ??
        null,
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
