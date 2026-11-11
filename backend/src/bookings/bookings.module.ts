import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { FlightBookingGateway } from './flight-booking.gateway';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: Airline.name, schema: AirlineSchema },
    ]),
  ],
  controllers: [BookingsController],
  providers: [BookingsService, FlightBookingGateway],
  exports: [BookingsService, FlightBookingGateway],
})
export class BookingsModule {}
