import { jest } from '@jest/globals';
import { MongoNotificationAdapter } from './notification.port';

describe('payment in-app notifications', () => {
  it('stores refund messages for the owning user', async () => {
    const insertOne = jest.fn(async () => ({}));
    const adapter = new MongoNotificationAdapter({
      collection: () => ({ insertOne }),
    } as never);
    await adapter.notify('owner-1', 'REFUND_ISSUED', 'Refund issued', {
      bookingId: 'booking-1',
    });
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        type: 'REFUND_ISSUED',
        data: { bookingId: 'booking-1' },
        readAt: null,
      }),
    );
  });
});
