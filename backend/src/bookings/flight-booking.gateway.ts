import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingsService } from './bookings.service';
import { BookingStatus } from './schemas/booking.schema';
import type { FlightPolicies } from '../airlines/schemas/airline.schema';

// Matches the flight side of Member 4's BookingGateway contract.
export interface PayableFlightBooking {
  id: string;
  type: 'flight';
  userId: string;
  status:
    'PendingPayment' | 'Confirmed' | 'Completed' | 'Expired' | 'Cancelled';
  totalAmount: number;
  currency: string;
  holdExpiresAt: Date | null;
  policiesAcceptedAt: Date | null;
  policySnapshot: FlightPolicies | null;
  startsAt: Date;
  reference: string | null;
}

const statusMap: Record<BookingStatus, PayableFlightBooking['status']> = {
  [BookingStatus.PENDING]: 'PendingPayment',
  [BookingStatus.PENDING_PAYMENT]: 'PendingPayment',
  [BookingStatus.CONFIRMED]: 'Confirmed',
  [BookingStatus.COMPLETED]: 'Completed',
  [BookingStatus.EXPIRED]: 'Expired',
  [BookingStatus.CANCELLED]: 'Cancelled',
};

@Injectable()
export class FlightBookingGateway {
  readonly type = 'flight' as const;

  constructor(
    private readonly bookings: BookingsService,
    private readonly config: ConfigService,
  ) {}

  async findById(id: string): Promise<PayableFlightBooking | null> {
    const view = await this.bookings.findForPayment(id);
    if (!view) return null;
    const currency = (
      this.config.get<string>('PLATFORM_CURRENCY') ?? 'usd'
    ).toLowerCase();
    return {
      id: view.id,
      type: this.type,
      userId: view.userId,
      status: statusMap[view.status],
      totalAmount: view.totalPrice,
      currency,
      holdExpiresAt: view.holdExpiresAt ?? null,
      policiesAcceptedAt: view.policiesAcceptedAt ?? null,
      policySnapshot: view.policySnapshot ?? null,
      startsAt: view.departureTimeUtc,
      reference: view.reference ?? null,
    };
  }

  getProviderPolicies(id: string): Promise<FlightPolicies> {
    return this.bookings.getCurrentPolicies(id);
  }

  savePolicyAcceptance(
    id: string,
    policy: FlightPolicies,
    acceptedAt: Date,
  ): Promise<void> {
    return this.bookings.savePolicyAcceptance(id, policy, acceptedAt);
  }

  async confirm(id: string): Promise<boolean> {
    try {
      await this.bookings.confirm(id);
      return true;
    } catch (error) {
      if (error instanceof BadRequestException) return false;
      throw error;
    }
  }

  expire(id: string): Promise<boolean> {
    return this.bookings.expireHold(id);
  }
}
