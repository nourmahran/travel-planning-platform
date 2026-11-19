import { OptionalJwt, InternalHotelEndpoint } from '../shared/auth/optional-jwt.decorator';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { AuthUser } from '../shared/auth/auth-user';
import { AuthGuard } from '../shared/auth/auth.guard';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { InternalApiKeyGuard } from '../shared/auth/internal-api-key.guard';
import { ParseMongoIdPipe } from '../shared/pipes/parse-mongo-id.pipe';
import {
  AttachPaymentIntentDto,
  CancelHotelBookingDto,
  ConfirmHotelBookingDto,
  CreateHotelBookingDto,
  ListMyBookingsQueryDto,
  UpdateRefundStatusDto,
} from './dto/booking.dto';
import { CreateReviewDto } from './dto/review.dto';
import {
  CancellationQuoteResponseDto,
  HotelBookingResponseDto,
  ReviewResponseDto,
} from './dto/responses.dto';
import { HotelBookingsService } from './hotel-bookings.service';
import { ReviewsService } from './reviews.service';

@ApiTags('Hotel bookings')
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(
    private readonly bookings: HotelBookingsService,
    private readonly reviews: ReviewsService,
  ) {}

  @Post()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-16 / HTL-18 Create a 10-minute reservation hold',
    description:
      'Atomically locks every selected room for every night of the stay. All rooms succeed or the whole request fails (409). Guests are assigned per room and validated against occupancy and the hotel children policy. The total is the sum of nightly prices × nights.',
  })
  @ApiCreatedResponse({ type: HotelBookingResponseDto })
  createHold(
    @Body() dto: CreateHotelBookingDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelBookingResponseDto> {
    return this.bookings.createHold(dto, user);
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-20 My reservation history',
    description:
      'Paginated, newest first. Filters: status, check-in from/to. Each item reports holdActive and canReview.',
  })
  @ApiOkResponse({
    description:
      'Paginated list: { items: HotelBookingResponseDto[], page, limit, total, totalPages }',
  })
  listMine(
    @Query() query: ListMyBookingsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookings.listMine(user, query);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'HTL-20 Reservation details',
    description:
      'Accessible to the guest, the assigned hotel moderator and administrators.',
  })
  @ApiOkResponse({ type: HotelBookingResponseDto })
  getOne(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelBookingResponseDto> {
    return this.bookings.getOne(id, user);
  }

  @Get(':id/cancellation-quote')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-21 Refund quote from the hotel cancellation tiers',
    description:
      'Returns the policy tier, refund percentage and amount (minor units) without cancelling. Member 4 can reuse the same numbers for its refund records.',
  })
  @ApiOkResponse({ type: CancellationQuoteResponseDto })
  quote(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<CancellationQuoteResponseDto> {
    return this.bookings.quoteCancellation(id, user);
  }

  @Post(':id/accept-policies')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'PAY-02 Record policy acceptance for this reservation',
    description:
      'Stores policiesAcceptedAt. Confirmation is blocked until this timestamp exists (REQUIRE_POLICY_ACCEPTANCE, default true). Member 4 may alternatively call the service/in its generic accept-policies endpoint.',
  })
  @ApiOkResponse({ type: HotelBookingResponseDto })
  acceptPolicies(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelBookingResponseDto> {
    return this.bookings.acceptPolicies(id, user);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @InternalHotelEndpoint()
  @UseGuards(InternalApiKeyGuard)
  @ApiOperation({
    summary: 'HTL-19 Confirm a reservation after verified payment (internal)',
    description:
      'Reserved for Member 4 (x-internal-api-key) or an administrator. Idempotent: confirming an already confirmed reservation returns it. An expired hold is released and rejected with 409.',
  })
  @ApiOkResponse({ type: HotelBookingResponseDto })
  confirm(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Body() dto: ConfirmHotelBookingDto = {},
  ): Promise<HotelBookingResponseDto> {
    return this.bookings.confirm(id, dto);
  }

  @Post(':id/payment-intent')
  @HttpCode(HttpStatus.OK)
  @InternalHotelEndpoint()
  @UseGuards(InternalApiKeyGuard)
  @ApiOperation({
    summary: 'Attach the Stripe PaymentIntent of a held reservation (internal)',
    description:
      'Lets Member 4 record the PaymentIntent id so the expiry job can cancel it when the 10-minute hold lapses (PAY-12).',
  })
  @ApiOkResponse({ type: HotelBookingResponseDto })
  attachPaymentIntent(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Body() dto: AttachPaymentIntentDto,
  ): Promise<HotelBookingResponseDto> {
    return this.bookings.attachPaymentIntent(id, dto);
  }

  @Patch(':id/refund')
  @InternalHotelEndpoint()
  @UseGuards(InternalApiKeyGuard)
  @ApiOperation({
    summary: 'PAY-17 Update refund status from Stripe (internal)',
    description:
      "Called by Member 4's webhook/reconciliation: PENDING, REFUNDED or FAILED, with the Stripe refund id.",
  })
  @ApiOkResponse({ type: HotelBookingResponseDto })
  updateRefund(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateRefundStatusDto,
  ): Promise<HotelBookingResponseDto> {
    return this.bookings.updateRefundStatus(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-21 Cancel a reservation',
    description:
      'The guest (or an administrator) cancels a hold or a confirmed reservation before check-in. The refund follows the cancellation tiers captured at booking time; the refund itself is executed by Member 4 through the payment port.',
  })
  @ApiOkResponse({ type: HotelBookingResponseDto })
  cancel(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Body() dto: CancelHotelBookingDto = {},
    @CurrentUser() user: AuthUser,
  ): Promise<HotelBookingResponseDto> {
    return this.bookings.cancel(id, user, dto);
  }

  @Post(':id/review')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-23 Review a completed stay',
    description:
      'Only the guest of a COMPLETED reservation may review it, and only once. The hotel average rating and review count are recalculated in the same transaction.',
  })
  @ApiCreatedResponse({ type: ReviewResponseDto })
  review(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Body() dto: CreateReviewDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReviewResponseDto> {
    return this.reviews.createForBooking(id, user, dto);
  }

  @Post('maintenance/run')
  @HttpCode(HttpStatus.OK)
  @InternalHotelEndpoint()
  @UseGuards(InternalApiKeyGuard)
  @ApiOperation({
    summary: 'Run hold expiry, stay completion and lock cleanup now',
    description:
      'Convenience for demos and tests; the same work runs automatically every minute/hour when ScheduleModule.forRoot() is loaded.',
  })
  runMaintenance() {
    return this.bookings.runMaintenance();
  }
}
