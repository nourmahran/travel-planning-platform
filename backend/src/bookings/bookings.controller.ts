
import {
  Body,
  Controller,
  Post,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@ApiTags('Bookings')
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a flight booking and reserve seats',
  })
  @ApiBody({ type: CreateBookingDto })
  @ApiResponse({
    status: 201,
    description: 'Booking created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid booking or insufficient seats',
  })
  @ApiResponse({
    status: 404,
    description: 'Flight not found',
  })
  async create(@Body() dto: CreateBookingDto) {
    return this.bookingsService.create(dto);
  }

  @Patch(':id/confirm')
  @ApiOperation({
    summary: 'Confirm a pending flight booking',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB booking ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Booking confirmed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Booking cannot be confirmed',
  })
  @ApiResponse({
    status: 404,
    description: 'Booking or flight not found',
  })
  async confirm(@Param('id') id: string) {
    return this.bookingsService.confirm(id);
  }

  @Patch(':id/cancel')
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
    description: 'Booking cannot be cancelled',
  })
  @ApiResponse({
    status: 404,
    description: 'Booking or flight not found',
  })
  async cancel(@Param('id') id: string) {
    return this.bookingsService.cancel(id);
  }
}
    