import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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
import { RefundResponseDto } from './dto/responses.dto';
import { API_PREFIX } from './payments.config';
import { RefundsService } from './refunds.service';
import { ApiErrors, BAD_PARAMS, UNAUTHORIZED } from './swagger';

@ApiTags('Refunds')
@ApiCookieAuth()
@ApiHeader({
  name: DEV_USER_HEADER,
  required: false,
  description:
    'DEV ONLY (until auth is merged): user ObjectId to act as. Ignored in production.',
})
@UseGuards(PaymentsAuthGuard) // TODO(part2): use real auth guard
@Controller(`${API_PREFIX}/refunds`)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'PAY-03: Get a refund',
    description:
      'PAY-03 — Refund details for the owner (or an admin): amount (major units), percent, reason and status (Pending, Refunded, Failed). Refunds are created automatically when a confirmed booking is cancelled.',
  })
  @ApiOkResponse({ type: RefundResponseDto })
  @ApiErrors(BAD_PARAMS, UNAUTHORIZED, [404, 'Refund not found'])
  get(
    @Param() params: IdParamDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RefundResponseDto> {
    return this.refunds.getRefund(user, params.id);
  }
}
