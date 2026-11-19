import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService } from './users.service';

const userId = new Types.ObjectId();

describe('account deactivation across booking modules', () => {
  const save = jest.fn().mockResolvedValue(undefined);
  const user = { _id: userId, status: 'active', save };
  const userModel = { findById: jest.fn().mockResolvedValue(user) };
  const sessions = { updateMany: jest.fn().mockResolvedValue({}) };
  const flightNext = jest.fn();
  const hotelFindOne = jest.fn();
  const hideItineraries = jest.fn().mockResolvedValue({});
  const collection = jest.fn((name: string) =>
    name === 'bookings'
      ? { aggregate: () => ({ next: flightNext }) }
      : name === 'hotel_bookings'
        ? { findOne: hotelFindOne }
        : { updateMany: hideItineraries },
  );
  const service = new UsersService(
    userModel as never,
    sessions as never,
    { db: { collection } } as never,
  );

  const authUser = { id: userId.toString() } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    user.status = 'active';
    flightNext.mockResolvedValue(null);
    hotelFindOne.mockResolvedValue(null);
  });

  it('blocks deactivation for an upcoming confirmed flight', async () => {
    flightNext.mockResolvedValue({ _id: new Types.ObjectId() });
    await expect(
      service.deactivateMe(authUser, { confirm: true }),
    ).rejects.toThrow(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('blocks deactivation for an upcoming confirmed hotel stay', async () => {
    hotelFindOne.mockResolvedValue({ _id: new Types.ObjectId() });
    await expect(
      service.deactivateMe(authUser, { confirm: true }),
    ).rejects.toThrow(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('hides public itineraries when a user deactivates', async () => {
    await service.deactivateMe(authUser, { confirm: true });
    expect(hideItineraries).toHaveBeenCalledWith(
      { ownerId: userId },
      { $set: { isHidden: true } },
    );
  });
});
