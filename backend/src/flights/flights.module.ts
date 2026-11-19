import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { ProviderFlightCancellationService } from './provider-flight-cancellation.service';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { PaymentsModule } from '../payments/payments.module';
import { BookingsModule } from '../bookings/bookings.module';

import { Flight, FlightSchema } from './schemas/flight.schema';

import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';

@Module({
  imports: [
    PaymentsModule,
    BookingsModule,
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      {
        name: Flight.name,
        schema: FlightSchema,
      },
      {
        name: Airline.name,
        schema: AirlineSchema,
      },
    ]),
  ],
  controllers: [FlightsController],
  providers: [FlightsService, ProviderFlightCancellationService],
  exports: [FlightsService, ProviderFlightCancellationService],
})
export class FlightsModule {}
