import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { FlightBookingGateway } from './flight-booking.gateway';
import { FLIGHT_BOOKING_ADAPTER } from '../common/booking/booking-adapter.interface';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: Airline.name, schema: AirlineSchema },
    ]),
  ],
  controllers: [BookingsController],
  providers: [
    BookingsService,
    FlightBookingGateway,
    { provide: FLIGHT_BOOKING_ADAPTER, useExisting: FlightBookingGateway },
  ],
  exports: [BookingsService, FlightBookingGateway, FLIGHT_BOOKING_ADAPTER],
})
export class BookingsModule {}
