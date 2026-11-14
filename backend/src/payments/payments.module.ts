import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsAuthGuard } from './auth/payments-auth.guard';
import { BookingGatewayRegistry } from './gateway/booking-gateway.registry';
import {
  MongoNotificationAdapter,
  NOTIFICATION_PORT,
} from './gateway/notification.port';
import { assertDevFlagSafe } from './payments.config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import {
  ProcessedEvent,
  ProcessedEventSchema,
} from './schemas/processed-event.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { stripeClientProvider } from './stripe/stripe.provider';
import { StripeService } from './stripe/stripe.service';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

/**
 * PAY-01 / PAY-03 / PAY-04 / GEN-11 — payments, refunds and the Stripe webhook.
 * Booking modules plug in through BookingGatewayRegistry (see
 * docs/api/payments-integration.md).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: ProcessedEvent.name, schema: ProcessedEventSchema },
    ]),
  ],
  // WebhookController first so POST /payments/webhook is matched before any :id route
  controllers: [WebhookController, PaymentsController, RefundsController],
  providers: [
    stripeClientProvider,
    StripeService,
    BookingGatewayRegistry,
    PaymentsService,
    RefundsService,
    WebhookService,
    PaymentsAuthGuard,
    { provide: NOTIFICATION_PORT, useClass: MongoNotificationAdapter },
  ],
  exports: [
    BookingGatewayRegistry,
    NOTIFICATION_PORT,
    PaymentsService,
    RefundsService,
    PaymentsAuthGuard,
  ],
})
export class PaymentsModule {
  constructor(config: ConfigService) {
    assertDevFlagSafe(config);
  }
}
