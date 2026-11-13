import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  ALLOWED_TEST_PAYMENT_METHODS,
  type TestPaymentMethod,
} from '../stripe/stripe.service';

/**
 * DEV ONLY. These are Stripe TEST payment-method tokens, not card numbers.
 * No card data is ever sent to or stored by the backend.
 */
export class DevConfirmDto {
  @ApiProperty({
    enum: ALLOWED_TEST_PAYMENT_METHODS,
    example: 'pm_card_visa',
    description:
      'pm_card_visa = success; pm_card_chargeDeclined = generic decline; pm_card_visa_chargeDeclinedInsufficientFunds = insufficient funds',
  })
  @IsIn(ALLOWED_TEST_PAYMENT_METHODS, {
    message: `testPaymentMethod must be one of: ${ALLOWED_TEST_PAYMENT_METHODS.join(', ')}`,
  })
  testPaymentMethod: TestPaymentMethod;
}
