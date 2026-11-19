import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { CurrencyController } from './currency.controller';
import { ExchangeRatesService } from './exchange-rates.service';
import { FxRatesClient } from './fxrates.client';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './schemas/exchange-rate.schema';

@Module({
  imports: [
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
  ],
  controllers: [CurrencyController],
  providers: [ExchangeRatesService, FxRatesClient],
  exports: [ExchangeRatesService],
})
export class CurrencyModule {}
