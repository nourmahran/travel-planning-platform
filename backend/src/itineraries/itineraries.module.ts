import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { DaysController } from './days.controller';
import { DaysService } from './days.service';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { BudgetSummaryService } from './budget-summary.service';
import { TransportCostsController } from './transport-costs.controller';
import { TransportCostsService } from './transport-costs.service';
import { ItinerariesPublicController } from './itineraries-public.controller';
import { ItinerariesPublicService } from './itineraries-public.service';
import { ItineraryTravelController } from './itinerary-travel.controller';
import { ItineraryHotelsService } from './itinerary-hotels.service';
import { ItineraryFlightsService } from './itinerary-flights.service';
import { HOTEL_SEARCH_PORT } from './hotel-search.port';
import { TeamHotelSearchPort } from './team-hotel-search.port';
import { HotelsModule } from '../hotels/hotels.module';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';
import { CurrencyModule } from '../currency/currency.module';
import { FlightsModule } from '../flights/flights.module';

@Module({
  imports: [
    ReferenceDataModule,
    CurrencyModule,
    FlightsModule,
    HotelsModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
  ],
  controllers: [
    ItinerariesController,
    ItinerariesPublicController,
    DaysController,
    ActivitiesController,
    BudgetsController,
    TransportCostsController,
    ItineraryTravelController,
  ],
  providers: [
    ItinerariesService,
    ItinerariesPublicService,
    DaysService,
    ActivitiesService,
    BudgetsService,
    TransportCostsService,
    BudgetSummaryService,
    ItineraryHotelsService,
    ItineraryFlightsService,
    TeamHotelSearchPort,
    { provide: HOTEL_SEARCH_PORT, useExisting: TeamHotelSearchPort },
  ],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
