import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from './auth/auth-user';
import { IdParamDto } from './dto/create-payment.dto';
import { RefundResponseDto } from './dto/responses.dto';
import { RefundsService } from './refunds.service';
import { ApiErrors, BAD_PARAMS, UNAUTHORIZED } from './swagger';

@ApiTags('Refunds')
@ApiCookieAuth('access_token')
@Controller('refunds')
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
