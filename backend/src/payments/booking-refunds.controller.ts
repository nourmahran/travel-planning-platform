import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BookingRefParamsDto } from '../policies/dto/policies.dto';
import type { AuthUser } from './auth/auth-user';
import { RefundResponseDto } from './dto/responses.dto';
import { API_PREFIX } from './payments.config';
import { RefundsService } from './refunds.service';
import { ApiErrors, BAD_PARAMS, UNAUTHORIZED } from './swagger';

@ApiTags('Refunds')
@ApiCookieAuth('access_token')
@Controller(`${API_PREFIX}/bookings`)
export class BookingRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get(':type/:id/refund')
  @ApiOperation({
    summary: 'PAY-03: Refund status of a booking',
    description:
      'PAY-03 — The latest refund of a flight booking or hotel reservation (amount, percent, reason, status Pending / Refunded / Failed), so booking details can show it. Owner or admin only.',
  })
  @ApiOkResponse({ type: RefundResponseDto })
  @ApiErrors(BAD_PARAMS, UNAUTHORIZED, [404, 'No refund for this booking'])
  get(
    @Param() params: BookingRefParamsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RefundResponseDto> {
    return this.refunds.getRefundForBooking(user, params.type, params.id);
  }
}
