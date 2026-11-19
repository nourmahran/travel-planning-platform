import { Module } from '@nestjs/common';
import { HOTEL_NOTIFICATION_SERVICE } from './notification.port';
import { PAYMENT_GATEWAY } from './payment-gateway.port';
import { PaymentsModule } from '../../payments/payments.module';
import { TeamHotelNotifications, TeamHotelPayments } from './team-adapters';

/**
 * Default (stand-alone) bindings for the two external services the hotels
 * module needs. They log instead of calling Stripe / Member 6.
 *
 * INTEGRATION: replace the two `useClass` values with Member 4's refund service
 * and Member 6's notification service, or import their modules and use
 * `useExisting`. See INTEGRATION.md.
 */
@Module({
  imports: [PaymentsModule],
  providers: [
    TeamHotelPayments,
    TeamHotelNotifications,
    { provide: PAYMENT_GATEWAY, useExisting: TeamHotelPayments },
    { provide: HOTEL_NOTIFICATION_SERVICE, useExisting: TeamHotelNotifications },
  ],
  exports: [PAYMENT_GATEWAY, HOTEL_NOTIFICATION_SERVICE],
})
export class HotelIntegrationsModule {}
