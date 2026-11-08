import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingGatewayRegistry } from './gateway/booking-gateway.registry';
import {
  LoggerNotificationAdapter,
  NOTIFICATION_PORT,
} from './gateway/notification.port';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import {
  ProcessedEvent,
  ProcessedEventSchema,
} from './schemas/processed-event.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { stripeClientProvider } from './stripe/stripe.provider';
import { StripeService } from './stripe/stripe.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: ProcessedEvent.name, schema: ProcessedEventSchema },
    ]),
  ],
  providers: [
    stripeClientProvider,
    StripeService,
    BookingGatewayRegistry,
    { provide: NOTIFICATION_PORT, useClass: LoggerNotificationAdapter },
  ],
  exports: [BookingGatewayRegistry, NOTIFICATION_PORT],
})
export class PaymentsModule {}
