
import { Module } from '@nestjs/common';

import { ReferenceDataService } from './reference-data.service';
import { CitiesController } from './cities.controller';

@Module({
  controllers: [CitiesController],
  providers: [ReferenceDataService],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
