
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

@Module({
  imports: [
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
  ],
  controllers: [ItinerariesController],
  providers: [ItinerariesService],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
