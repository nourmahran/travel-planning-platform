import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus, BookingType, getPlatformCurrency } from '../common/booking';
import { BookingGatewayRegistry } from '../payments/gateway/booking-gateway.registry';
import type { BookingGateway, PayableBooking, ProviderPolicies } from '../payments/gateway/booking-gateway.interface';
import { FlightChangeExecutionService } from './flight-change-execution.service';
import { BookingsService } from './bookings.service';
import { BookingStatus as FlightBookingStatus } from './schemas/booking.schema';

@Injectable()
export class FlightChangeGateway implements BookingGateway, OnModuleInit {
  readonly type = BookingType.FlightChange;
  constructor(
    private readonly changes: FlightChangeExecutionService,
    private readonly bookings: BookingsService,
    private readonly registry: BookingGatewayRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() { this.registry.register(this); }

  async findById(id: string): Promise<PayableBooking | null> {
    const change = await this.changes.find(id);
    if (!change) return null;
    const booking = await this.bookings.findForPayment(String(change.bookingId));
    if (!booking) return null;
    return {
      id, type: this.type, userId: String(change.userId),
      status: booking.status === FlightBookingStatus.CANCELLED
        ? BookingStatus.Cancelled : change.status as BookingStatus,
      totalAmount: change.amountDue,
      currency: getPlatformCurrency(this.config),
      holdExpiresAt: change.holdExpiresAt,
      policiesAcceptedAt: new Date(),
      policySnapshot: booking.policySnapshot as ProviderPolicies | null,
      startsAt: booking.departureTimeUtc,
      reference: booking.reference,
    };
  }

  async getProviderPolicies(id: string): Promise<ProviderPolicies> {
    const change = await this.changes.find(id);
    if (!change) throw new Error('Flight change not found');
    return this.bookings.getCurrentPolicies(String(change.bookingId));
  }

  async savePolicyAcceptance(): Promise<void> {
    // Original confirmed booking already carries the accepted policy snapshot.
  }

  async confirm(id: string): Promise<boolean> {
    try {
      const done = await this.changes.confirm(id);
      if (!done) await this.changes.expire(id, true);
      return done;
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      await this.changes.expire(id, true);
      return false;
    }
  }

  expire(id: string): Promise<boolean> { return this.changes.expire(id); }
}
