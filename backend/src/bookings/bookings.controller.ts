import {
  Body,
  Controller,
  Post,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
  Get,
  Query,
  StreamableFile,
  ForbiddenException,
  Header,
} from '@nestjs/common';
import {
  ApiExcludeController,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingRequestDto } from './dto/create-booking.dto';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/constants/roles';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { FlightCancellationService } from './flight-cancellation.service';
import { Public } from '../auth/decorators/public.decorator';
import { RequireVerifiedEmail } from '../auth/decorators/require-verified-email.decorator';
import { CabinClass } from '../flights/schemas/flight.schema';
import { FlightChangeService, type ChangeLeg } from './flight-change.service';
import { FlightChangeExecutionService } from './flight-change-execution.service';
import { RequestFlightChangeDto } from './dto/request-flight-change.dto';

// Superseded in Swagger by FlightBookingsController (/api/flight-bookings) and
// FlightsController (/api/flights/:id/bookings). Kept so existing clients work.
@ApiExcludeController()
@ApiTags('Bookings')
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly cancellations: FlightCancellationService,
    private readonly flightChanges: FlightChangeService,
    private readonly changeExecution: FlightChangeExecutionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a flight booking with a temporary seat hold',
  })
  @Roles(UserRole.USER)
  @RequireVerifiedEmail()
  @ApiBody({ type: CreateBookingRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Booking created with a temporary seat hold',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid booking or insufficient seats',
  })
  @ApiResponse({
    status: 404,
    description: 'Flight not found',
  })
  async create(
    @Body() dto: CreateBookingRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookingsService.create(
      Object.assign({}, dto, { userId: user.id }),
    );
  }

  @Get('history')
  @Roles(UserRole.USER)
  history(@CurrentUser() user: AuthenticatedUser) {
    return this.bookingsService.historyForUser(user.id);
  }

  @Get('flights/:flightId/seats')
  @Public()
  @ApiOperation({ summary: 'FLT-28 Available numbered seats for a flight cabin' })
  seats(
    @Param('flightId', ParseObjectIdPipe) flightId: string,
    @Query('cabin') cabin: CabinClass,
  ) { return this.bookingsService.availableSeats(flightId, cabin); }

  @Get('airline/:flightId/passengers')
  @Roles(UserRole.AIRLINE_MODERATOR, UserRole.ADMIN)
  passengers(
    @Param('flightId', ParseObjectIdPipe) flightId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('airlineId') adminAirlineId?: string,
  ) {
    const airlineId =
      user.role === UserRole.ADMIN ? adminAirlineId : user.providerId;
    if (!airlineId) throw new ForbiddenException('Airline scope required');
    return this.bookingsService.listForAirline(
      flightId,
      airlineId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
    );
  }

  @Get('airline/:flightId/passengers.csv')
  @Roles(UserRole.AIRLINE_MODERATOR, UserRole.ADMIN)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async passengerCsv(
    @Param('flightId', ParseObjectIdPipe) flightId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('airlineId') adminAirlineId?: string,
  ): Promise<string> {
    const airlineId =
      user.role === UserRole.ADMIN ? adminAirlineId : user.providerId;
    if (!airlineId) throw new ForbiddenException('Airline scope required');
    let csv = '';
    for await (const chunk of this.bookingsService.exportPassengers(
      flightId,
      airlineId,
    ))
      csv += chunk;
    return csv;
  }

  @Get(':id')
  @Roles(UserRole.USER)
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookingsService.findOne(id, user.id);
  }

  @Get(':id/change-preview')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'FLT-27 Preview a same-route confirmed flight change and fare difference' })
  changePreview(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('flightId', ParseObjectIdPipe) flightId: string,
    @Query('leg') leg: ChangeLeg = 'outbound',
  ) { return this.flightChanges.preview(id, user.id, flightId, leg); }

  @Post(':id/change')
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'FLT-27 Hold a replacement flight and request any fare payment' })
  changeFlight(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestFlightChangeDto,
  ) { return this.changeExecution.request(id, user.id, dto.flightId, dto.leg ?? 'outbound'); }

  @Get(':id/ticket')
  @Roles(UserRole.USER)
  async ticket(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const pdf = await this.bookingsService.generateTicket(id, user.id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="ticket-${id}.pdf"`,
    });
  }

  @Get(':id/cancellation-preview')
  @Roles(UserRole.USER)
  previewCancellation(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cancellations.previewForUser(id, user.id);
  }

  // Confirmation must only be triggered after verified payment.
  // The public confirmation endpoint is intentionally disabled
  // until the payment integration is implemented.

  @Patch(':id/cancel')
  @Roles(UserRole.USER)
  @ApiOperation({
    summary: 'Cancel a booking and restore reserved seats',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB booking ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Booking cancelled and seats restored',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid booking ID or booking cannot be cancelled',
  })
  @ApiResponse({
    status: 404,
    description: 'Booking or flight not found',
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
}
