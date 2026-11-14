import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountStatus } from '../auth/constants/account-status';
import {
  RefreshSession,
  RefreshSessionDocument,
} from '../auth/schemas/refresh-session.schema';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { toSafeUser } from '../auth/utils/safe-user';
import {
  Booking,
  BookingDocument,
  BookingStatus,
} from '../bookings/schemas/booking.schema';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(RefreshSession.name)
    private readonly refreshSessionModel: Model<RefreshSessionDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
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
      dto.preferredCurrency === undefined
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

    await user.save();
    return {
      message: 'Profile updated successfully',
      user: toSafeUser(user),
    };
  }

  async deactivateMe(
    authUser: AuthenticatedUser,
    dto: DeactivateAccountDto,
  ) {
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

    await this.refreshSessionModel.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );

    return { message: 'Account deactivated successfully' };
  }

  /**
   * ACC-12 — block deactivation when upcoming Confirmed bookings exist.
   * Uses Member 2 flight bookings (hotel bookings arrive with Member 3).
   */
  private async hasUpcomingConfirmedBookings(userId: string): Promise<boolean> {
    const now = new Date();
    const confirmed = await this.bookingModel
      .find({
        userId,
        status: BookingStatus.CONFIRMED,
      })
      .populate('flightId', 'departureTimeUtc')
      .exec();

    return confirmed.some((booking) => {
      const flight = booking.flightId as unknown as {
        departureTimeUtc?: Date;
      } | null;
      return (
        !!flight?.departureTimeUtc &&
        flight.departureTimeUtc.getTime() >= now.getTime()
      );
    });
  }
}
