import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus, BookingType } from '../../common/booking';
import { PaymentExpirySweeper } from '../payment-expiry.sweeper';
import { RefundsService } from '../refunds.service';

function sweeperSetup(
  open: Array<{ bookingType: BookingType; bookingId: Types.ObjectId }>,
  statuses: Record<string, BookingStatus | null>,
  registered: BookingType[] = [BookingType.Flight, BookingType.Hotel],
) {
  const payments = {
    find: jest.fn(() => ({
      select: () => ({ lean: () => ({ exec: async () => open }) }),
    })),
  };
  const gateway = {
    findById: jest.fn(async (id: string) =>
      statuses[id] === null ? null : { status: statuses[id] },
    ),
  };
  const registry = {
    isRegistered: jest.fn((t: BookingType) => registered.includes(t)),
    get: jest.fn(() => gateway),
  };
  const paymentsService = {
    cancelForExpiredBooking: jest.fn(async () => ({ cancelled: 1 })),
  };
  const sweeper = new PaymentExpirySweeper(
    payments as never,
    registry as never,
    paymentsService as never,
  );
  return { sweeper, paymentsService, gateway };
}

describe('PaymentExpirySweeper (PAY-01: cancel PaymentIntent when the hold expires)', () => {
  const expired = new Types.ObjectId();
  const pending = new Types.ObjectId();
  const cancelled = new Types.ObjectId();
  const missing = new Types.ObjectId();

  it('cancels open payments only for Expired, Cancelled or missing bookings', async () => {
    const { sweeper, paymentsService } = sweeperSetup(
      [
        { bookingType: BookingType.Flight, bookingId: expired },
        { bookingType: BookingType.Flight, bookingId: pending },
        { bookingType: BookingType.Hotel, bookingId: cancelled },
        { bookingType: BookingType.Flight, bookingId: missing },
      ],
      {
        [String(expired)]: BookingStatus.Expired,
        [String(pending)]: BookingStatus.PendingPayment,
        [String(cancelled)]: BookingStatus.Cancelled,
        [String(missing)]: null,
      },
    );
    const now = new Date('2026-11-15T10:00:00Z');
    await expect(sweeper.sweep(now)).resolves.toEqual({ cancelled: 3 });
    const calls = paymentsService.cancelForExpiredBooking.mock
      .calls as unknown[][];
    expect(calls).toEqual(
      expect.arrayContaining([
        [BookingType.Flight, String(expired), now],
        [BookingType.Hotel, String(cancelled), now],
        [BookingType.Flight, String(missing), now],
      ]),
    );
    expect(calls).not.toContainEqual([
      BookingType.Flight,
      String(pending),
      now,
    ]);
  });

  it('checks each booking once even with several open payments', async () => {
    const { sweeper, gateway } = sweeperSetup(
      [
        { bookingType: BookingType.Flight, bookingId: expired },
        { bookingType: BookingType.Flight, bookingId: expired },
      ],
      { [String(expired)]: BookingStatus.Expired },
    );
    await sweeper.sweep();
    expect(gateway.findById).toHaveBeenCalledTimes(1);
  });

  it('skips booking types that are not wired yet', async () => {
    const { sweeper, paymentsService } = sweeperSetup(
      [{ bookingType: BookingType.Hotel, bookingId: expired }],
      { [String(expired)]: BookingStatus.Expired },
      [BookingType.Flight],
    );
    await expect(sweeper.sweep()).resolves.toEqual({ cancelled: 0 });
    expect(paymentsService.cancelForExpiredBooking).not.toHaveBeenCalled();
  });

  it('keeps going when one booking fails', async () => {
    const { sweeper, paymentsService } = sweeperSetup(
      [
        { bookingType: BookingType.Flight, bookingId: expired },
        { bookingType: BookingType.Hotel, bookingId: cancelled },
      ],
      {
        [String(expired)]: BookingStatus.Expired,
        [String(cancelled)]: BookingStatus.Cancelled,
      },
    );
    paymentsService.cancelForExpiredBooking
      .mockRejectedValueOnce(new Error('stripe down'))
      .mockResolvedValueOnce({ cancelled: 1 });
    await expect(sweeper.sweep()).resolves.toEqual({ cancelled: 1 });
  });
});

describe('RefundsService.getRefundForBooking (PAY-03: refund status on booking details)', () => {
  const owner = { id: new Types.ObjectId().toString(), role: 'user' };
  function service(refund: unknown) {
    const svc = Object.create(RefundsService.prototype) as RefundsService;
    (svc as unknown as { findLatestByBooking: unknown }).findLatestByBooking =
      jest.fn(async () => refund);
    return svc;
  }
  const refundDoc = {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(owner.id),
    bookingType: BookingType.Flight,
    bookingId: new Types.ObjectId(),
    paymentId: new Types.ObjectId(),
    amount: 5000,
    currency: 'usd',
    percent: 50,
    reason: 'UserCancellation',
    status: 'Refunded',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('returns the latest refund to its owner', async () => {
    const res = await service(refundDoc).getRefundForBooking(
      owner,
      BookingType.Flight,
      String(refundDoc.bookingId),
    );
    expect(res).toMatchObject({ status: 'Refunded', percent: 50 });
  });

  it('lets an admin read it', async () => {
    await expect(
      service(refundDoc).getRefundForBooking(
        { id: new Types.ObjectId().toString(), role: 'admin' },
        BookingType.Flight,
        String(refundDoc.bookingId),
      ),
    ).resolves.toMatchObject({ status: 'Refunded' });
  });

  it('404 for another user or when there is no refund', async () => {
    await expect(
      service(refundDoc).getRefundForBooking(
        { id: new Types.ObjectId().toString(), role: 'user' },
        BookingType.Flight,
        String(refundDoc.bookingId),
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service(null).getRefundForBooking(owner, BookingType.Flight, 'x'),
    ).rejects.toThrow(NotFoundException);
  });
});
