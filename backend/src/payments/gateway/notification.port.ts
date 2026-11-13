import { Injectable, Logger } from '@nestjs/common';

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
 * Default adapter used until the notifications module exists.
 * TODO(part2): replace with an adapter that writes to the notifications collection.
 */
@Injectable()
export class LoggerNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger('PaymentNotifications');

  notify(
    userId: string,
    type: PaymentNotificationType,
    message: string,
  ): Promise<void> {
    this.logger.log(`[${type}] user=${userId}: ${message}`);
    return Promise.resolve();
  }
}
