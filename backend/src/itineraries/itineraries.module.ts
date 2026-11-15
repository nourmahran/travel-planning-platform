
import { Module } from '@nestjs/common';

import { ReferenceDataModule } from '../reference-data/reference-data.module';

@Module({
  imports: [ReferenceDataModule],
})
export class ItinerariesModule {}
