import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { PaymentsModule } from '../payments/payments.module';
import { FlightBookingGateway } from './flight-booking.gateway';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: Airline.name, schema: AirlineSchema },
    ]),
    // Gives access to BookingGatewayRegistry, RefundsService and PaymentsService.
    // PaymentsModule does not import BookingsModule, so there is no cycle.
    PaymentsModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService, FlightBookingGateway],
  exports: [BookingsService],
})
export class BookingsModule {}
