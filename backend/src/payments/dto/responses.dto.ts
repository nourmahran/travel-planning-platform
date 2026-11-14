import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingType } from '../../common/booking';
import { PaymentStatus } from '../schemas/payment.schema';
import { RefundReason, RefundStatus } from '../schemas/refund.schema';

/** All `amount` fields in API responses are in MAJOR units (e.g. 250.5). */

export class CreatePaymentResponseDto {
  @ApiProperty({ example: '6730f1c2a4b5c6d7e8f90456' })
  paymentId: string;

  @ApiProperty({
    example: 'pi_3Q..._secret_...',
    description:
      'Pass this to Stripe Elements (stripe.confirmPayment) in the browser. It is never stored by the backend.',
  })
  clientSecret: string;

  @ApiProperty({ example: 250.5 })
  amount: number;

  @ApiProperty({ example: 'usd' })
  currency: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.Pending })
  status: PaymentStatus;

  @ApiProperty({ type: Date, example: '2026-11-08T10:10:00.000Z' })
  holdExpiresAt: Date | null;
}

export class PaymentResponseDto {
  @ApiProperty({ example: '6730f1c2a4b5c6d7e8f90456' })
  id: string;

  @ApiProperty({ enum: BookingType, example: BookingType.Flight })
  bookingType: BookingType;

  @ApiProperty({ example: '6730f1c2a4b5c6d7e8f90123' })
  bookingId: string;

  @ApiProperty({ example: 250.5 })
  amount: number;

  @ApiProperty({ example: 'usd' })
  currency: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.Succeeded })
  status: PaymentStatus;

  @ApiPropertyOptional({ example: 'Your card was declined.', nullable: true })
  failureMessage: string | null;

  @ApiProperty({ example: 1 })
  attempts: number;

  @ApiProperty({ type: Date, example: '2026-11-08T10:01:00.000Z' })
  createdAt: Date | null;
}

export class RefundResponseDto {
  @ApiProperty({ example: '6730f1c2a4b5c6d7e8f90789' })
  id: string;

  @ApiProperty({ enum: BookingType, example: BookingType.Hotel })
  bookingType: BookingType;

  @ApiProperty({ example: '6730f1c2a4b5c6d7e8f90123' })
  bookingId: string;

  @ApiProperty({ example: 125.25 })
  amount: number;

  @ApiProperty({ example: 50 })
  percent: number;

  @ApiProperty({ example: 'usd' })
  currency: string;

  @ApiProperty({ enum: RefundReason, example: RefundReason.UserCancellation })
  reason: RefundReason;

  @ApiProperty({ enum: RefundStatus, example: RefundStatus.Refunded })
  status: RefundStatus;

  @ApiPropertyOptional({ example: null, nullable: true })
  failureMessage: string | null;

  @ApiProperty({ type: Date, example: '2026-11-08T11:00:00.000Z' })
  createdAt: Date | null;
}

export class RefundPreviewDto {
  @ApiProperty({ example: 50 })
  percent: number;

  @ApiProperty({ example: 125.25 })
  amount: number;

  @ApiProperty({ example: 'usd' })
  currency: string;

  @ApiProperty({ example: 12 })
  daysRemaining: number;

  @ApiProperty({ example: true })
  cancellable: boolean;

  @ApiPropertyOptional({ example: 'The flight has already departed' })
  message?: string;
}

export class WebhookAckDto {
  @ApiProperty({ example: true })
  received: true;
}

export class DevConfirmResponseDto {
  @ApiProperty({ example: '6730f1c2a4b5c6d7e8f90456' })
  paymentId: string;

  @ApiProperty({
    example: 'succeeded',
    description: 'Stripe PaymentIntent status right after confirmation',
  })
  paymentIntentStatus: string;

  @ApiProperty({
    example:
      'Confirmation sent to Stripe. The booking is confirmed only when the payment_intent.succeeded webhook arrives.',
  })
  message: string;
}
