import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientSession } from 'mongoose';
import {
  type BookingPaymentAdapter,
  type PayableBooking,
  type ProviderPolicySnapshot,
} from '../common/booking/booking-adapter.interface';
import { BookingStatus as PaymentBookingStatus } from '../common/booking/booking-status.enum';
import { BookingType } from '../common/booking/booking-type.enum';
import { BookingsService } from './bookings.service';
import { BookingStatus } from './schemas/booking.schema';

const statusMap: Record<BookingStatus, PaymentBookingStatus> = {
  [BookingStatus.PENDING]: PaymentBookingStatus.PENDING_PAYMENT,
  [BookingStatus.PENDING_PAYMENT]: PaymentBookingStatus.PENDING_PAYMENT,
  [BookingStatus.CONFIRMED]: PaymentBookingStatus.CONFIRMED,
  [BookingStatus.COMPLETED]: PaymentBookingStatus.COMPLETED,
  [BookingStatus.EXPIRED]: PaymentBookingStatus.EXPIRED,
  [BookingStatus.CANCELLED]: PaymentBookingStatus.CANCELLED,
};

@Injectable()
export class FlightBookingGateway implements BookingPaymentAdapter {
  constructor(
    private readonly bookings: BookingsService,
    private readonly config: ConfigService,
  ) {}

  async findForPayment(id: string): Promise<PayableBooking | null> {
    const view = await this.bookings.findForPayment(id);
    if (!view?.holdExpiresAt) return null;
    return {
      id: view.id,
      type: BookingType.FLIGHT,
      userId: view.userId,
      status: statusMap[view.status],
      totalAmount: view.totalPrice,
      currency: (
        this.config.get<string>('PLATFORM_CURRENCY') ?? 'usd'
      ).toLowerCase(),
      holdExpiresAt: view.holdExpiresAt,
      providerId: view.providerId,
      refundReferenceDate: view.departureTimeUtc,
    };
  }

  async getPolicies(id: string): Promise<ProviderPolicySnapshot> {
    const policy = await this.bookings.getPaymentPolicyContext(id);
    return { type: BookingType.FLIGHT, ...policy };
  }

  async confirmAfterPayment(
    id: string,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!session)
      throw new BadRequestException(
        'Payment confirmation requires a transaction',
      );
    try {
      await this.bookings.confirm(id, session);
      return true;
    } catch (error) {
      if (error instanceof BadRequestException) return false;
      throw error;
    }
  }

  expireHold(id: string): Promise<boolean> {
    return this.bookings.expireHold(id);
  }

  markCompleted(id: string): Promise<boolean> {
    return this.bookings.markCompleted(id);
  }

  findExpiredHoldIds(now: Date): Promise<string[]> {
    return this.bookings.findExpiredHoldIds(now);
  }

  findCompletableIds(now: Date): Promise<string[]> {
    return this.bookings.findCompletableIds(now);
  }
}
