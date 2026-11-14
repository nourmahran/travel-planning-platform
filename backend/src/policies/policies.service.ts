import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingType } from '../common/booking';
import {
  assertHoldActive,
  assertPendingPayment,
  loadOwnedBooking,
} from '../payments/booking-access';
import { BookingGatewayRegistry } from '../payments/gateway/booking-gateway.registry';
import type {
  AcceptPoliciesResponseDto,
  PoliciesResponseDto,
} from './dto/policies.dto';

/**
 * PAY-02 — show the provider's policies before payment and store the user's
 * acceptance with a timestamp.
 *
 * Why we store a SNAPSHOT of the policies (not just a flag): refunds must use
 * the cancellation tiers the user actually agreed to, even if the airline or
 * hotel moderator edits the tiers later.
 */
@Injectable()
export class PoliciesService {
  constructor(private readonly registry: BookingGatewayRegistry) {}

  async getPolicies(
    type: BookingType,
    bookingId: string,
    userId: string,
  ): Promise<PoliciesResponseDto> {
    const gateway = this.registry.get(type);
    const booking = await loadOwnedBooking(gateway, bookingId, userId);

    const accepted = !!booking.policiesAcceptedAt && !!booking.policySnapshot;
    const policies =
      accepted && booking.policySnapshot
        ? booking.policySnapshot
        : await gateway.getProviderPolicies(bookingId);

    return {
      bookingType: type,
      bookingId,
      policies,
      accepted,
      acceptedAt: accepted ? booking.policiesAcceptedAt : null,
    };
  }

  async acceptPolicies(
    type: BookingType,
    bookingId: string,
    userId: string,
    accepted: boolean,
    now: Date = new Date(),
  ): Promise<AcceptPoliciesResponseDto> {
    if (accepted !== true) {
      throw new BadRequestException('You must accept the policies');
    }
    const gateway = this.registry.get(type);
    const booking = await loadOwnedBooking(gateway, bookingId, userId);

    // Idempotent: accepting twice keeps the FIRST timestamp and snapshot.
    if (booking.policiesAcceptedAt && booking.policySnapshot) {
      return {
        accepted: true,
        acceptedAt: booking.policiesAcceptedAt,
        policies: booking.policySnapshot,
      };
    }

    assertPendingPayment(booking);
    assertHoldActive(booking, now);

    const snapshot = await gateway.getProviderPolicies(bookingId);
    await gateway.savePolicyAcceptance(bookingId, snapshot, now);
    return { accepted: true, acceptedAt: now, policies: snapshot };
  }
}
