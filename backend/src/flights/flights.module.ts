
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';

import {
  Flight,
  FlightSchema,
} from './schemas/flight.schema';

import {
  Airline,
  AirlineSchema,
} from '../airlines/schemas/airline.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
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
  providers: [FlightsService],
  exports: [FlightsService],
})
export class FlightsModule {}
