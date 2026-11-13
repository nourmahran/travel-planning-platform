import { jest } from '@jest/globals';
import { MongoNotificationAdapter } from './notification.port';

describe('payment in-app notifications', () => {
  it('stores refund messages for the owning user', async () => {
    const updateOne = jest.fn(async () => ({}));
    const adapter = new MongoNotificationAdapter({
      collection: () => ({ updateOne }),
    } as never);
    await adapter.notify(
      '507f1f77bcf86cd799439011',
      'REFUND_ISSUED',
      'Refund issued',
      {
        bookingId: 'booking-1',
        refundId: 'refund-1',
      },
    );
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'payment:REFUND_ISSUED:refund-1' }),
      {
        $setOnInsert: expect.objectContaining({
          type: 'refund.updated',
          message: 'Refund issued',
        }),
      },
      { upsert: true },
    );
  });
});
