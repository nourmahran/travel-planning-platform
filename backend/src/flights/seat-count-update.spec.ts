import { jest } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FlightsService } from './flights.service';
import { CabinClass, FlightStatus } from './schemas/flight.schema';

describe('flight seat-count updates', () => {
  const id = new Types.ObjectId();
  const future = new Date(Date.now() + 86_400_000);
  const flight = () => ({
    _id: id,
    status: FlightStatus.SCHEDULED,
    departureTimeUtc: future,
    cabins: [
      { cabinClass: CabinClass.ECONOMY, totalSeats: 10, availableSeats: 3 },
    ],
  });
  const findById = jest.fn();
  const findOneAndUpdate = jest.fn();
  const service = new FlightsService(
    { findById, findOneAndUpdate } as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    findById.mockReturnValue({ exec: async () => flight() });
  });

  it('rejects reducing seats below the seven already allocated', async () => {
    await expect(
      service.update(id.toString(), {
        cabins: [{ cabinClass: CabinClass.ECONOMY, totalSeats: 6 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('atomically adjusts total and available seats and detects a stale read', async () => {
    findOneAndUpdate.mockReturnValue({ exec: async () => null });
    await expect(
      service.update(id.toString(), {
        cabins: [{ cabinClass: CabinClass.ECONOMY, totalSeats: 12 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const [filter, update] = findOneAndUpdate.mock.calls[0] as unknown as [
      {
        cabins: { $elemMatch: { totalSeats: number; availableSeats: number } };
      },
      { $inc: Record<string, number> },
    ];
    expect(filter.cabins.$elemMatch).toMatchObject({
      totalSeats: 10,
      availableSeats: 3,
    });
    expect(update.$inc).toEqual({
      'cabins.$.totalSeats': 2,
      'cabins.$.availableSeats': 2,
    });
  });
});
