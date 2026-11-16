import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { BookingType } from '../../common/booking';
import { notificationRecord } from '../../common/notification-record';
import { RefundsService } from '../../payments/refunds.service';
import { RefundReason } from '../../payments/schemas/refund.schema';
import { StripeService } from '../../payments/stripe/stripe.service';
import type { HotelNotification, NotificationPort } from './notification.port';
import type {
  HotelRefundRequest,
  HotelRefundResult,
  PaymentGatewayPort,
} from './payment-gateway.port';

@Injectable()
export class TeamHotelPayments implements PaymentGatewayPort {
  constructor(
    private readonly refunds: RefundsService,
    private readonly stripe: StripeService,
  ) {}

  async refundHotelBooking(
    request: HotelRefundRequest,
  ): Promise<HotelRefundResult> {
    const refund = await this.refunds.issueRefund(
      BookingType.Hotel,
      request.bookingId,
      request.providerInitiated
        ? RefundReason.ProviderCancellation
        : RefundReason.UserCancellation,
    );
    if (!refund) return { status: 'REFUNDED' };
    return {
      status: refund.status.toUpperCase() as HotelRefundResult['status'],
      providerRefundId: refund.stripeRefundId,
      failureReason: refund.failureMessage,
    };
  }

  async cancelPaymentIntent(request: {
    paymentIntentId: string;
    bookingId: string;
  }): Promise<void> {
    await this.stripe.cancelPaymentIntent(request.paymentIntentId);
  }
}

@Injectable()
export class TeamHotelNotifications implements NotificationPort {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async send(input: HotelNotification): Promise<void> {
    const type =
      input.type === 'HOTEL_BOOKING_CONFIRMED'
        ? 'booking.confirmed'
        : input.type === 'HOTEL_BOOKING_CANCELLED'
          ? 'booking.cancelled'
          : 'booking.updated';
    const bookingId =
      typeof input.data?.bookingId === 'string'
        ? input.data.bookingId
        : undefined;
    const record = notificationRecord({
      recipientId: input.userId,
      eventId: `hotel:${input.type}:${bookingId ?? input.title}`,
      type,
      title: input.title,
      message: input.message,
      link: bookingId ? `/api/hotel-bookings/${bookingId}` : undefined,
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
