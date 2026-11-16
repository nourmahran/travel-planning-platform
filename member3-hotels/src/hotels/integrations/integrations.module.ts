import { Module } from '@nestjs/common';
import { LoggingNotificationService, HOTEL_NOTIFICATION_SERVICE } from './notification.port';
import { LoggingPaymentGateway, PAYMENT_GATEWAY } from './payment-gateway.port';

/**
 * Default (stand-alone) bindings for the two external services the hotels
 * module needs. They log instead of calling Stripe / Member 6.
 *
 * INTEGRATION: replace the two `useClass` values with Member 4's refund service
 * and Member 6's notification service, or import their modules and use
 * `useExisting`. See INTEGRATION.md.
 */
@Module({
  providers: [
    { provide: PAYMENT_GATEWAY, useClass: LoggingPaymentGateway },
    { provide: HOTEL_NOTIFICATION_SERVICE, useClass: LoggingNotificationService },
  ],
  exports: [PAYMENT_GATEWAY, HOTEL_NOTIFICATION_SERVICE],
})
export class HotelIntegrationsModule {}
