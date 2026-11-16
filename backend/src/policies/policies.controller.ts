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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../payments/auth/auth-user';
import { API_PREFIX } from '../payments/payments.config';
import {
  ApiErrors,
  BAD_PARAMS,
  NOT_WIRED,
  UNAUTHORIZED,
} from '../payments/swagger';
import {
  AcceptPoliciesDto,
  AcceptPoliciesResponseDto,
  BookingRefParamsDto,
  PoliciesResponseDto,
} from './dto/policies.dto';
import { PoliciesService } from './policies.service';

@ApiTags('Policies')
@ApiCookieAuth('access_token')
@Controller(`${API_PREFIX}/bookings`)
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get(':type/:id/policies')
  @ApiOperation({
    summary: 'PAY-02: Get the provider policies for a booking',
    description:
      'PAY-02 — Returns the airline (cancellation + baggage) or hotel (cancellation + check-in/check-out times) policies the user must accept before paying. Once accepted, returns the stored snapshot the user agreed to.',
  })
  @ApiOkResponse({ type: PoliciesResponseDto })
  @ApiErrors(BAD_PARAMS, UNAUTHORIZED, [404, 'Booking not found'], NOT_WIRED)
  getPolicies(
    @Param() params: BookingRefParamsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PoliciesResponseDto> {
    return this.policies.getPolicies(params.type, params.id, user.id);
  }

  @Post(':type/:id/accept-policies')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PAY-02: Accept the provider policies (required before payment)',
    description:
      'PAY-02 — Stores the acceptance timestamp and a snapshot of the policies on the booking. Payment is blocked until this is done. Calling it again returns the original timestamp (idempotent).',
  })
  @ApiOkResponse({ type: AcceptPoliciesResponseDto })
  @ApiErrors(
    [400, 'You must accept the policies'],
    BAD_PARAMS,
    UNAUTHORIZED,
    [404, 'Booking not found'],
    [409, 'Booking is not awaiting payment'],
    [410, 'Booking hold has expired'],
    NOT_WIRED,
  )
  acceptPolicies(
    @Param() params: BookingRefParamsDto,
    @Body() body: AcceptPoliciesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AcceptPoliciesResponseDto> {
    return this.policies.acceptPolicies(
      params.type,
      params.id,
      user.id,
      body.accepted,
    );
  }
}
