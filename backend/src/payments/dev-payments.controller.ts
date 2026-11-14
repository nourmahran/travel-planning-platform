import {
  Body,
  type CanActivate,
  Controller,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from './auth/auth-user';
import { CurrentUser } from './auth/current-user.decorator';
import { DEV_USER_HEADER, PaymentsAuthGuard } from './auth/payments-auth.guard';
import { IdParamDto } from './dto/create-payment.dto';
import { DevConfirmDto } from './dto/dev-confirm.dto';
import { DevConfirmResponseDto } from './dto/responses.dto';
import { API_PREFIX, isDevPaymentsEnabled } from './payments.config';
import { PaymentsService } from './payments.service';
import { ApiErrors, BAD_PARAMS, UNAUTHORIZED } from './swagger';

/**
 * Second line of defence: even if the controller were registered by mistake,
 * every call is rejected with 404 unless dev endpoints are enabled.
 */
@Injectable()
export class DevPaymentsEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (!isDevPaymentsEnabled(this.config)) throw new NotFoundException();
    return true;
  }
}

/**
 * DEV / TEST MODE ONLY — Milestone 1 is graded in Swagger, where there is no
 * Stripe Elements card form. This endpoint confirms a PaymentIntent with a
 * Stripe TEST token so the full flow (incl. the webhook) can be demoed.
 * Registered only when ENABLE_DEV_PAYMENT_ENDPOINTS=true and NODE_ENV is not
 * production (see DevPaymentsModule).
 */
@ApiTags('Dev (test mode only)')
@ApiCookieAuth()
@ApiHeader({
  name: DEV_USER_HEADER,
  required: false,
  description:
    'DEV ONLY (until auth is merged): user ObjectId to act as. Ignored in production.',
})
@UseGuards(DevPaymentsEnabledGuard, PaymentsAuthGuard) // TODO(part2): use real auth guard
@Controller(`${API_PREFIX}/dev/payments`)
export class DevPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'PAY-01 (dev only): Simulate the card form with a Stripe test token',
    description:
      'PAY-01 — DEV/TEST MODE ONLY. Confirms the PaymentIntent with a Stripe test payment method (these are Stripe test tokens, NOT card data). The booking is still confirmed ONLY by the Stripe webhook (run `stripe listen --forward-to localhost:3000/api/payments/webhook`). Use pm_card_chargeDeclined to demo a failed payment and then POST /api/payments/{id}/retry.',
  })
  @ApiOkResponse({ type: DevConfirmResponseDto })
  @ApiErrors(
    BAD_PARAMS,
    [400, 'testPaymentMethod must be one of the allowed Stripe test tokens'],
    UNAUTHORIZED,
    [404, 'Payment not found'],
    [409, 'Only Pending payments can be confirmed'],
    [502, 'Payment provider error'],
  )
  confirm(
    @Param() params: IdParamDto,
    @Body() body: DevConfirmDto,
    @CurrentUser() user: AuthUser,
  ): Promise<DevConfirmResponseDto> {
    return this.payments.devConfirm(user, params.id, body.testPaymentMethod);
  }
}
