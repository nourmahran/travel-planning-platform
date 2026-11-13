import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { notificationRecord } from '../../common/notification-record';

export type PaymentNotificationType =
  'REFUND_ISSUED' | 'REFUND_FAILED' | 'PAYMENT_FAILED';

/**
 * How the payments module sends in-app notifications (PAY-03) without
 * depending on the notifications module directly.
 */
export interface NotificationPort {
  notify(
    userId: string,
    type: PaymentNotificationType,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');

/**
 * Persist payment and refund events alongside flight notifications.
 */
@Injectable()
export class MongoNotificationAdapter implements NotificationPort {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async notify(
    userId: string,
    type: PaymentNotificationType,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const eventKey =
      (typeof data?.refundId === 'string' && data.refundId) ||
      (typeof data?.paymentId === 'string' && data.paymentId) ||
      randomUUID();
    const bookingId = typeof data?.bookingId === 'string' ? data.bookingId : undefined;
    const record = notificationRecord({
      recipientId: userId,
      eventId: `payment:${type}:${eventKey}`,
      type: type === 'PAYMENT_FAILED' ? 'payment.failed' : 'refund.updated',
      title: type === 'PAYMENT_FAILED' ? 'Payment failed' : 'Refund update',
      message,
      link: bookingId ? `/bookings/${bookingId}` : undefined,
    });
    await this.connection
      .collection('notifications')
      .updateOne(
        { recipientId: record.recipientId, eventId: record.eventId },
        { $setOnInsert: record },
        { upsert: true },
      );
  }
}
