import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus, BookingType } from '../common/booking';
import { BookingGatewayRegistry } from '../payments/gateway/booking-gateway.registry';
import type {
  BookingGateway,
  HotelPolicies,
  PayableBooking,
  ProviderPolicies,
} from '../payments/gateway/booking-gateway.interface';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  HotelBooking,
  HotelBookingDocument,
  HotelBookingStatus,
} from './schemas/hotel-booking.schema';

const status: Record<HotelBookingStatus, BookingStatus> = {
  HELD: BookingStatus.PendingPayment,
  CONFIRMED: BookingStatus.Confirmed,
  CANCELLED: BookingStatus.Cancelled,
  COMPLETED: BookingStatus.Completed,
  EXPIRED: BookingStatus.Expired,
};

@Injectable()
export class HotelBookingGateway implements BookingGateway, OnModuleInit {
  readonly type = BookingType.Hotel;

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly model: Model<HotelBookingDocument>,
    private readonly bookings: HotelBookingsService,
    private readonly registry: BookingGatewayRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  private async find(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model.findById(id).exec();
  }

  private policies(booking: HotelBooking): HotelPolicies {
    return {
      kind: 'hotel',
      checkInTime: booking.policySnapshot.checkInTime,
      checkOutTime: booking.policySnapshot.checkOutTime,
      cancellationTiers: booking.policySnapshot.cancellationTiers.map(
        (tier) => ({
          daysBefore: tier.minDaysBeforeCheckIn,
          refundPercent: tier.refundPercent,
        }),
      ),
    };
  }

  async findById(id: string): Promise<PayableBooking | null> {
    const booking = await this.find(id);
    if (!booking) return null;
    return {
      id,
      type: this.type,
      userId: booking.userId.toString(),
      status: status[booking.status],
      totalAmount: booking.totalAmountCents / 100,
      currency: booking.currency.toLowerCase(),
      holdExpiresAt: booking.holdExpiresAt ?? null,
      policiesAcceptedAt: booking.policiesAcceptedAt ?? null,
      policySnapshot: booking.policiesAcceptedAt
        ? this.policies(booking)
        : null,
      startsAt: new Date(`${booking.checkIn}T00:00:00.000Z`),
      reference: booking.reference,
    };
  }

  async getProviderPolicies(id: string): Promise<ProviderPolicies> {
    const booking = await this.find(id);
    if (!booking) throw new ConflictException('Hotel booking not found');
    return this.policies(booking);
  }

  async savePolicyAcceptance(
    id: string,
    snapshot: ProviderPolicies,
    acceptedAt: Date,
  ): Promise<void> {
    if (snapshot.kind !== 'hotel')
      throw new ConflictException('Expected hotel policies');
    await this.bookings.recordPolicyAcceptance(
      new Types.ObjectId(id),
      acceptedAt,
    );
  }

  async confirm(id: string): Promise<boolean> {
    try {
      await this.bookings.confirm(new Types.ObjectId(id));
      return true;
    } catch (error) {
      if (error instanceof ConflictException) return false;
      throw error;
    }
  }

  async expire(id: string): Promise<boolean> {
    return this.bookings.expireHold(new Types.ObjectId(id));
  }
}
