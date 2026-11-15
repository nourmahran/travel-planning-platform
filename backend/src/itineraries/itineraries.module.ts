
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { DaysController } from './days.controller';
import { DaysService } from './days.service';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

@Module({
  imports: [
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
  ],
  controllers: [ItinerariesController, DaysController, ActivitiesController],
  providers: [ItinerariesService, DaysService, ActivitiesService],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
