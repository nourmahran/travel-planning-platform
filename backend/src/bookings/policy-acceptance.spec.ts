import { jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { FlightPoliciesDto } from '../airlines/dto/flight-policies.dto';
import { AirlinesService } from '../airlines/airlines.service';
import { BookingsService } from './bookings.service';
import { BookingStatus } from './schemas/booking.schema';

const policy = {
  cancellationTiers: [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 0, refundPercent: 0 },
  ],
  baggage: {
    freeBagsPerPassenger: 1,
    maxWeightKgPerBag: 23,
    extraBagPrice: 50,
    maxExtraBagsPerPassenger: 2,
  },
};

describe('Airline policy acceptance', () => {
  it('rejects duplicate cancellation thresholds while allowing no day-zero tier', async () => {
    const service = new AirlinesService({
      findOne: async () => null,
      create: async () => ({}),
    } as never);
    const airline = { code: 'MS', name: 'EgyptAir', countryCode: 'EG' };
    await expect(
      service.create({
        ...airline,
        flightPolicies: {
          ...policy,
          cancellationTiers: [
            { daysBefore: 7, refundPercent: 50 },
            { daysBefore: 7, refundPercent: 10 },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({
        ...airline,
        flightPolicies: {
          ...policy,
          cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        },
      }),
    ).resolves.toEqual({});
  });

  it('validates the full baggage and cancellation shape', async () => {
    const invalid = plainToInstance(FlightPoliciesDto, {
      cancellationTiers: [{ daysBefore: -1, refundPercent: 120 }],
      baggage: {
        freeBagsPerPassenger: -1,
        maxWeightKgPerBag: 0,
        extraBagPrice: -5,
        maxExtraBagsPerPassenger: -1,
      },
    });
    expect(await validate(invalid)).toHaveLength(2);
    expect(
      await validate(plainToInstance(FlightPoliciesDto, policy)),
    ).toHaveLength(0);
  });

  it('stores an independent snapshot only while the hold is active', async () => {
    const id = '507f1f77bcf86cd799439011';
    const booking = {
      _id: id,
      userId: 'user',
      flightId: 'flight',
      cabinClass: 'Economy',
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date('2030-01-01'),
    };
    const accepted = {
      ...booking,
      policiesAcceptedAt: new Date('2029-01-01'),
      policySnapshot: policy,
    };
    const bookings = {
      findOne: jest.fn().mockReturnValue({ exec: async () => booking }),
      findById: jest.fn().mockReturnValue({ exec: async () => booking }),
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue({ exec: async () => accepted }),
    };
    const flights = {
      findById: jest.fn().mockReturnValue({
        exec: async () => ({
          airlineId: 'airline',
          cabins: [{ cabinClass: 'Economy' }],
        }),
      }),
    };
    const airlines = {
      findById: jest
        .fn()
        .mockReturnValue({ exec: async () => ({ flightPolicies: policy }) }),
    };
    const service = new BookingsService(
      bookings as never,
      flights as never,
      airlines as never,
    );
    const now = new Date('2029-01-01');
    await expect(service.acceptPolicies(id, 'user', now)).resolves.toBe(
      accepted,
    );
    expect(bookings.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: id,
        userId: 'user',
        holdExpiresAt: { $gt: now },
      }),
      {
        $set: {
          policiesAcceptedAt: now,
          policySnapshot: { kind: 'flight', ...policy },
        },
      },
      { new: true, runValidators: true },
    );
    const stored = (
      bookings.findOneAndUpdate.mock.calls[0] as unknown[]
    )[1] as { $set: { policySnapshot: typeof policy } };
    expect(stored.$set.policySnapshot.cancellationTiers[0]).not.toBe(
      policy.cancellationTiers[0],
    );
    booking.holdExpiresAt = new Date('2028-01-01');
    await expect(
      service.acceptPolicies(id, 'user', now),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
