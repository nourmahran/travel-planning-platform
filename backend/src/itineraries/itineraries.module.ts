
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
import { TransportCostsController } from './transport-costs.controller';
import { TransportCostsService } from './transport-costs.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

@Module({
  imports: [
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
  ],
  controllers: [
    ItinerariesController,
    DaysController,
    ActivitiesController,
    BudgetsController,
    TransportCostsController,
  ],
  providers: [
    ItinerariesService,
    DaysService,
    ActivitiesService,
    BudgetsService,
    TransportCostsService,
  ],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
