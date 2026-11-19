import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AccountStatus } from '../auth/constants/account-status';
import {
  RefreshSession,
  RefreshSessionDocument,
} from '../auth/schemas/refresh-session.schema';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { toSafeUser } from '../auth/utils/safe-user';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(RefreshSession.name)
    private readonly refreshSessionModel: Model<RefreshSessionDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  async getMe(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Not logged in');
    }
    return { user: toSafeUser(user) };
  }

  async updateMe(authUser: AuthenticatedUser, dto: UpdateProfileDto) {
    if (
      dto.name === undefined &&
      dto.phone === undefined &&
      dto.preferredCurrency === undefined &&
      dto.emailNotifications === undefined
    ) {
      throw new BadRequestException('No profile fields provided');
    }

    const user = await this.userModel.findById(authUser.id);
    if (!user) {
      throw new UnauthorizedException('Not logged in');
    }

    if (dto.name !== undefined) {
      user.name = dto.name.trim();
    }
    if (dto.phone !== undefined) {
      user.phone = dto.phone.trim();
    }
    if (dto.preferredCurrency !== undefined) {
      user.preferredCurrency = dto.preferredCurrency.trim().toUpperCase();
    }
    if (dto.emailNotifications !== undefined) {
      user.emailNotifications = dto.emailNotifications;
    }

    await user.save();
    return {
      message: 'Profile updated successfully',
      user: toSafeUser(user),
    };
  }

  async deactivateMe(authUser: AuthenticatedUser, dto: DeactivateAccountDto) {
    if (!dto.confirm) {
      throw new BadRequestException(
        'Confirmation is required to deactivate the account',
      );
    }

    const hasUpcoming = await this.hasUpcomingConfirmedBookings(authUser.id);
    if (hasUpcoming) {
      throw new BadRequestException(
        'Cannot deactivate account while upcoming Confirmed bookings exist',
      );
    }

    const user = await this.userModel.findById(authUser.id);
    if (!user) {
      throw new UnauthorizedException('Not logged in');
    }

    user.status = AccountStatus.DEACTIVATED;
    await user.save();
    await this.connection.db
      ?.collection('itineraries')
      .updateMany({ ownerId: user._id }, { $set: { isHidden: true } });

    await this.refreshSessionModel.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );

    return { message: 'Account deactivated successfully' };
  }

  /** ACC-12: check the actual flight and hotel booking collections. */
  private async hasUpcomingConfirmedBookings(userId: string): Promise<boolean> {
    const db = this.connection.db;
    if (!db) {
      return false;
    }

    const now = new Date();
    const [flight, hotel] = await Promise.all([
      db
        .collection('bookings')
        .aggregate([
          { $match: { userId, status: 'Confirmed' } },
          {
            $lookup: {
              from: 'flights',
              localField: 'flightId',
              foreignField: '_id',
              as: 'outbound',
            },
          },
          {
            $lookup: {
              from: 'flights',
              localField: 'returnFlightId',
              foreignField: '_id',
              as: 'inbound',
            },
          },
          {
            $match: {
              $or: [
                { 'outbound.departureTimeUtc': { $gte: now } },
                { 'inbound.departureTimeUtc': { $gte: now } },
              ],
            },
          },
          { $limit: 1 },
        ])
        .next(),
      db.collection('hotel_bookings').findOne({
        userId: new Types.ObjectId(userId),
        status: 'CONFIRMED',
        checkOut: { $gt: now.toISOString().slice(0, 10) },
      }),
    ]);
    return !!flight || !!hotel;
  }
}
