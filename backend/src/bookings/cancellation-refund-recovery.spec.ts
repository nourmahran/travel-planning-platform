import { jest } from '@jest/globals';
import { Types } from 'mongoose';
import { CancellationRefundRecoveryService } from './cancellation-refund-recovery.service';
import { RefundReason } from '../payments/schemas/refund.schema';
import { BookingType } from '../common/booking';

describe('cancellation refund recovery', () => {
  it('retries and clears a recorded refund dispatch', async () => {
    const id = new Types.ObjectId();
    const updateOne = jest.fn(async () => ({}));
    const issueRefund = jest.fn(async () => ({}));
    const service = new CancellationRefundRecoveryService(
      {
        find: () => ({
          select: () => ({
            exec: async () => [
              {
                _id: id,
                refundDispatchReason: RefundReason.ProviderCancellation,
              },
            ],
          }),
        }),
        updateOne,
      } as never,
      { issueRefund, issueChangedFlightRefund: jest.fn(async () => null) } as never,
    );
    await service.retryPendingRefunds();
    expect(issueRefund).toHaveBeenCalledWith(
      BookingType.Flight,
      id.toString(),
      RefundReason.ProviderCancellation,
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: id, refundDispatchPending: true },
      { $set: { refundDispatchPending: false } },
    );
  });

  it('keeps the pending marker when dispatch fails so the next run retries', async () => {
    const id = new Types.ObjectId();
    const updateOne = jest.fn();
    const service = new CancellationRefundRecoveryService(
      {
        find: () => ({
          select: () => ({
            exec: async () => [
              {
                _id: id,
                refundDispatchReason: RefundReason.UserCancellation,
              },
            ],
          }),
        }),
        updateOne,
      } as never,
      {
        issueRefund: async () => {
          throw new Error('temporary failure');
        },
      } as never,
    );
    await service.retryPendingRefunds();
    expect(updateOne).not.toHaveBeenCalled();
  });
});
