import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from './auth/auth-user';
import { CreatePaymentDto, IdParamDto } from './dto/create-payment.dto';
import {
  CreatePaymentResponseDto,
  PaymentResponseDto,
} from './dto/responses.dto';
import { PaymentsService } from './payments.service';
import { ApiErrors, BAD_PARAMS, NOT_WIRED, UNAUTHORIZED } from './swagger';

const PAYABLE_ERRORS: Array<[number, string]> = [
  [400, 'Policies must be accepted before payment'],
  [400, 'Unsupported currency'],
  [400, 'Booking amount must be greater than 0'],
  BAD_PARAMS,
  UNAUTHORIZED,
  [404, 'Booking not found'],
  [409, 'Booking is not awaiting payment'],
  [409, 'Booking already paid'],
  [409, 'A payment for this booking is already being processed'],
  [410, 'Booking hold has expired'],
  [502, 'Payment provider error'],
  NOT_WIRED,
];

@ApiTags('Payments')
@ApiCookieAuth('access_token')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @ApiOperation({
    summary: 'PAY-01: Create a payment for a booking',
    description:
      'PAY-01 — Create a Stripe PaymentIntent for a PendingPayment flight booking or hotel reservation within its hold period. The amount is read from the booking (never from the request). Returns the clientSecret for Stripe Elements; card details go directly to Stripe. The booking is confirmed only after the Stripe webhook reports success. If an open PaymentIntent already exists it is reused.',
  })
  @ApiCreatedResponse({ type: CreatePaymentResponseDto })
  @ApiErrors(...PAYABLE_ERRORS)
  create(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CreatePaymentResponseDto> {
    return this.payments.createPayment(user, dto);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PAY-01: Retry a failed payment',
    description:
      'PAY-01 — After a declined card the user may retry until the hold expires. Reuses the same PaymentIntent when Stripe allows it, otherwise creates a new one. Returns a clientSecret.',
  })
  @ApiOkResponse({ type: CreatePaymentResponseDto })
  @ApiErrors(
    ...PAYABLE_ERRORS,
    [404, 'Payment not found'],
    [409, 'Payment is not retryable'],
  )
  retry(
    @Param() params: IdParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CreatePaymentResponseDto> {
    return this.payments.retryPayment(user, params.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'PAY-01: Get a payment',
    description:
      'PAY-01 — Payment status for the owner (or an admin). Only the Stripe payment ID, amount, currency and status are stored; amount is returned in major units.',
  })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiErrors(BAD_PARAMS, UNAUTHORIZED, [404, 'Payment not found'])
  get(
    @Param() params: IdParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentResponseDto> {
    return this.payments.getPayment(user, params.id);
  }
}
