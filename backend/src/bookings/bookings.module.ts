import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsController } from './bookings.controller';
import { FlightBookingsController } from './flight-bookings.controller';
import { BookingsService } from './bookings.service';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { PaymentsModule } from '../payments/payments.module';
import { FlightBookingGateway } from './flight-booking.gateway';
import { FlightCancellationService } from './flight-cancellation.service';
import { CancellationRefundRecoveryService } from './cancellation-refund-recovery.service';
import { FlightChangeService } from './flight-change.service';
import { FlightChangeExecutionService } from './flight-change-execution.service';
import { FlightChangeGateway } from './flight-change.gateway';
import { FlightChange, FlightChangeSchema } from './schemas/flight-change.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Refund, RefundSchema } from '../payments/schemas/refund.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: Airline.name, schema: AirlineSchema },
      { name: FlightChange.name, schema: FlightChangeSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
    // Gives access to BookingGatewayRegistry, RefundsService and PaymentsService.
    // PaymentsModule does not import BookingsModule, so there is no cycle.
    PaymentsModule,
  ],
  controllers: [BookingsController, FlightBookingsController],
  providers: [
    BookingsService,
    FlightBookingGateway,
    FlightCancellationService,
    CancellationRefundRecoveryService,
    FlightChangeService,
    FlightChangeExecutionService,
    FlightChangeGateway,
  ],
  exports: [BookingsService, FlightCancellationService],
})
export class BookingsModule {}
