import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

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
    await this.connection.collection('notifications').insertOne({
      userId,
      type,
      message,
      data: data ?? {},
      createdAt: new Date(),
      readAt: null,
    });
  }
}
