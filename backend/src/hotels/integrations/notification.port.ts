import { Logger } from '@nestjs/common';

export const HOTEL_NOTIFICATION_SERVICE = Symbol('HOTELS_NOTIFICATION_SERVICE');

export interface HotelNotification {
  userId: string;
  /** Notification type understood by Member 6, e.g. HOTEL_BOOKING_CONFIRMED. */
  type:
    | 'HOTEL_BOOKING_CONFIRMED'
    | 'HOTEL_BOOKING_CANCELLED'
    | 'HOTEL_BOOKING_EXPIRED'
    | 'HOTEL_STAY_COMPLETED'
    | 'HOTEL_REVIEW_RECEIVED';
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * INTEGRATION (Member 6): mandatory in-app notifications.
 *
 * Notifications must never break a booking operation, so the hotels services
 * call this port inside try/catch and only log failures.
 */
export interface NotificationPort {
  send(notification: HotelNotification): Promise<void>;
}

export class LoggingNotificationService implements NotificationPort {
  private readonly logger = new Logger('HotelsNotifications');

  async send(notification: HotelNotification): Promise<void> {
    this.logger.log(
      `[${notification.type}] user=${notification.userId} :: ${notification.title} - ${notification.message}`,
    );
  }
}
