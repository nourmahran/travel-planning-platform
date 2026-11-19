import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus, BookingType } from '../../common/booking';
import { PoliciesService } from '../../policies/policies.service';
import { BookingGatewayRegistry } from '../gateway/booking-gateway.registry';
import { FakeBookingGateway, HOTEL_POLICIES } from './fake-booking.gateway';

const id = () => new Types.ObjectId().toString();

describe('PAY-02 PoliciesService', () => {
  let flights: FakeBookingGateway;
  let hotels: FakeBookingGateway;
  let service: PoliciesService;
  const owner = id();
  const stranger = id();

  beforeEach(() => {
    const registry = new BookingGatewayRegistry();
    flights = new FakeBookingGateway(BookingType.Flight);
    hotels = new FakeBookingGateway(BookingType.Hotel);
    registry.register(flights);
    registry.register(hotels);
    service = new PoliciesService(registry);
  });

  describe('getPolicies', () => {
    it('returns live hotel policies before acceptance', async () => {
      const b = hotels.seed({ id: id(), userId: owner });
      const res = await service.getPolicies(BookingType.Hotel, b.id, owner);
      expect(res).toMatchObject({
        bookingType: 'hotel',
        bookingId: b.id,
        accepted: false,
        acceptedAt: null,
        policies: HOTEL_POLICIES,
      });
    });

    it('returns 404 for another user (does not reveal existence)', async () => {
      const b = flights.seed({ id: id(), userId: owner });
      await expect(
        service.getPolicies(BookingType.Flight, b.id, stranger),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 404 for a missing booking', async () => {
      await expect(
        service.getPolicies(BookingType.Flight, id(), owner),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the accepted snapshot, not later policy edits', async () => {
      const b = flights.seed({ id: id(), userId: owner });
      await service.acceptPolicies(BookingType.Flight, b.id, owner, true);
      flights.policies = {
        ...flights.policies,
        cancellationTiers: [{ daysBefore: 0, refundPercent: 0 }],
      };
      const res = await service.getPolicies(BookingType.Flight, b.id, owner);
      expect(res.accepted).toBe(true);
      expect(res.policies.cancellationTiers).toHaveLength(3);
    });
  });

  describe('acceptPolicies', () => {
    it('stores a snapshot and timestamp', async () => {
      const b = flights.seed({ id: id(), userId: owner });
      const now = new Date();
      const res = await service.acceptPolicies(
        BookingType.Flight,
        b.id,
        owner,
        true,
        now,
      );
      expect(res).toMatchObject({ accepted: true, acceptedAt: now });
      const stored = await flights.findById(b.id);
      expect(stored?.policiesAcceptedAt).toBe(now);
      expect(stored?.policySnapshot).toEqual(flights.policies);
    });

    it('rejects accepted=false with 400', async () => {
      const b = flights.seed({ id: id(), userId: owner });
      await expect(
        service.acceptPolicies(BookingType.Flight, b.id, owner, false),
      ).rejects.toThrow(
        new BadRequestException('You must accept the policies'),
      );
    });

    it('rejects a booking that is not owned with 404', async () => {
      const b = flights.seed({ id: id(), userId: owner });
      await expect(
        service.acceptPolicies(BookingType.Flight, b.id, stranger, true),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a booking that is not PendingPayment with 409', async () => {
      const b = flights.seed({
        id: id(),
        userId: owner,
        status: BookingStatus.Expired,
      });
      await expect(
        service.acceptPolicies(BookingType.Flight, b.id, owner, true),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an expired hold with 410', async () => {
      const b = flights.seed({ id: id(), userId: owner });
      flights.setHoldExpired(b.id);
      await expect(
        service.acceptPolicies(BookingType.Flight, b.id, owner, true),
      ).rejects.toThrow(GoneException);
    });

    it('is idempotent: a repeat accept keeps the first timestamp', async () => {
      const b = flights.seed({ id: id(), userId: owner });
      const first = new Date('2026-11-08T10:00:00Z');
      await service.acceptPolicies(
        BookingType.Flight,
        b.id,
        owner,
        true,
        first,
      );
      const again = await service.acceptPolicies(
        BookingType.Flight,
        b.id,
        owner,
        true,
        new Date(first.getTime() + 60_000),
      );
      expect(again.acceptedAt).toBe(first);
      expect(flights.savePolicyCalls).toBe(1);
    });
  });
});
