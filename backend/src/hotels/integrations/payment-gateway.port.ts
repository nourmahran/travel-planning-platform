import { Logger } from '@nestjs/common';

export const PAYMENT_GATEWAY = Symbol('HOTELS_PAYMENT_GATEWAY');

export interface HotelRefundRequest {
  bookingId: string;
  bookingReference: string;
  userId: string;
  amountCents: number;
  currency: string;
  reason: string;
  providerInitiated?: boolean;
  /** Stripe PaymentIntent id recorded by Member 4, when available. */
  paymentId?: string | null;
}

export interface HotelRefundResult {
  status: 'PENDING' | 'REFUNDED' | 'FAILED';
  providerRefundId?: string;
  failureReason?: string;
}

/**
 * INTEGRATION (Member 4): payment, webhooks and Stripe Refunds.
 *
 * The hotels module never talks to Stripe. On cancellation it asks this port
 * for the refund and stores the returned status on the reservation
 * (RefundStatus.PENDING / REFUNDED / FAILED). Member 4 replaces the logging
 * implementation registered in IntegrationsModule with their real service.
 */
export interface PaymentGatewayPort {
  refundHotelBooking(request: HotelRefundRequest): Promise<HotelRefundResult>;
  cancelPaymentIntent(request: { paymentIntentId: string; bookingId: string }): Promise<void>;
}

export class LoggingPaymentGateway implements PaymentGatewayPort {
  private readonly logger = new Logger('HotelsPaymentGateway');

  async refundHotelBooking(request: HotelRefundRequest): Promise<HotelRefundResult> {
    this.logger.warn(
      `Refund not executed: Member 4's payment module is not wired yet. booking=${request.bookingReference} amount=${request.amountCents} ${request.currency}`,
    );
    return { status: 'PENDING' };
  }

  async cancelPaymentIntent(request: { paymentIntentId: string; bookingId: string }): Promise<void> {
    this.logger.warn(
      `PaymentIntent not cancelled: Member 4's payment module is not wired yet. booking=${request.bookingId} intent=${request.paymentIntentId}`,
    );
  }
}
