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
  StreamableFile,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingRequestDto } from './dto/create-booking.dto';
import { RequestFlightChangeDto } from './dto/request-flight-change.dto';
import { SelectSeatDto } from './dto/select-seat.dto';
import { FlightCancellationService } from './flight-cancellation.service';
import { FlightChangeService, type ChangeLeg } from './flight-change.service';
import { FlightChangeExecutionService } from './flight-change-execution.service';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequireVerifiedEmail } from '../auth/decorators/require-verified-email.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/constants/roles';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CabinClass } from '../flights/schemas/flight.schema';

/**
 * Flight booking routes named as in the project description (section 8.4).
 * The older /api/bookings routes stay for existing clients but are hidden
 * from Swagger.
 */
@ApiTags('Flight Bookings')
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly cancellations: FlightCancellationService,
    private readonly flightChanges: FlightChangeService,
    private readonly changeExecution: FlightChangeExecutionService,
  ) {}

  @Post('hold')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.USER)
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: 'FLT-22 Hold seats for the selected flight(s) and passengers',
    description:
      'Reserves inventory atomically and returns a booking awaiting payment. The hold expires automatically and releases the seats if payment is not verified in time. Pay with POST /api/payments.',
  })
  @ApiBody({ type: CreateBookingRequestDto })
  @ApiResponse({ status: 201, description: 'Seats held; booking awaits payment' })
  @ApiResponse({ status: 400, description: 'Invalid request or not enough seats' })
  hold(
    @Body() dto: CreateBookingRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookingsService.create(Object.assign({}, dto, { userId: user.id }));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.USER)
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: 'FLT-19, FLT-21 Create a flight booking with passengers and baggage',
    description:
      'Same operation as /hold: passenger, baggage and seat details are priced, seats are held, and the booking waits for verified payment before it is confirmed.',
  })
  @ApiBody({ type: CreateBookingRequestDto })
  create(
    @Body() dto: CreateBookingRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookingsService.create(Object.assign({}, dto, { userId: user.id }));
  }

  @Get()
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'FLT-25 List my flight bookings' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.bookingsService.historyForUser(user.id);
  }

  @Get('flights/:flightId/seats')
  @Public()
  @ApiOperation({ summary: 'FLT-28 Free numbered seats in a flight cabin' })
  seats(
    @Param('flightId', ParseObjectIdPipe) flightId: string,
    @Query('cabin') cabin: CabinClass,
  ) {
    return this.bookingsService.availableSeats(flightId, cabin);
  }

  @Get(':id')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'FLT-25 Get one of my flight bookings' })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookingsService.findOne(id, user.id);
  }

  @Get(':id/cancellation-preview')
  @Roles(UserRole.USER)
  @ApiOperation({
    summary: 'FLT-26 Preview the refund a cancellation would produce',
  })
  cancellationPreview(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cancellations.previewForUser(id, user.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.USER)
  @ApiOperation({
    summary: 'FLT-26 Cancel my booking under the airline policy',
    description:
      'Unpaid holds are released immediately. Confirmed bookings release their seats and request the tier-based refund.',
  })
  async cancel(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const booking = await this.bookingsService.findOne(id, user.id);
    if (booking.status === 'Confirmed')
      return this.cancellations.cancelForUser(id, user.id);
    return this.bookingsService.cancel(id);
  }

  @Get(':id/change-preview')
  @Roles(UserRole.USER)
  @ApiOperation({
    summary: 'FLT-27 (Optional) Preview a flight change and its fare difference',
  })
  changePreview(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('flightId', ParseObjectIdPipe) flightId: string,
    @Query('leg') leg: ChangeLeg = 'outbound',
  ) {
    return this.flightChanges.preview(id, user.id, flightId, leg);
  }

  @Patch(':id/change-flight')
  @Roles(UserRole.USER)
  @ApiOperation({
    summary: 'FLT-27 (Optional) Change to another flight on the same route',
    description:
      'Holds the replacement flight. A higher fare is charged through Stripe before the change is applied; a lower fare is refunded.',
  })
  changeFlight(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestFlightChangeDto,
  ) {
    return this.changeExecution.request(
      id,
      user.id,
      dto.flightId,
      dto.leg ?? 'outbound',
    );
  }

  @Get(':id/e-ticket')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'FLT-23 Download the e-ticket PDF' })
  async eTicket(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const pdf = await this.bookingsService.generateTicket(id, user.id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="ticket-${id}.pdf"`,
    });
  }

  @Patch(':id/seat')
  @Roles(UserRole.USER)
  @ApiOperation({
    summary: "FLT-28 (Optional) Choose or change a passenger's numbered seat",
  })
  selectSeat(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SelectSeatDto,
  ) {
    return this.bookingsService.selectSeat(
      id,
      user.id,
      dto.passengerIndex,
      dto.seatNumber,
      dto.leg ?? 'outbound',
    );
  }
}
