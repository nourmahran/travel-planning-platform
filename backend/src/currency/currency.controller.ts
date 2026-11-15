import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { ExchangeRatesService } from './exchange-rates.service';
import { ConvertQueryDto } from './dto/convert-query.dto';

@ApiTags('Currency')
@Public()
@Controller('currency')
export class CurrencyController {
  constructor(private readonly exchangeRates: ExchangeRatesService) {}

  @Get('convert')
  @ApiOperation({
    summary: 'Convert an amount between display currencies',
    description:
      'ITN-18. Uses one cached rate document per UTC day, fetched from the FX API on first use, and the newest cached document when the API fails. Returns the rate date and whether the table is live, cached or stale.',
  })
  convert(@Query() query: ConvertQueryDto) {
    return this.exchangeRates.convert(query.amount, query.from, query.to);
  }
}
