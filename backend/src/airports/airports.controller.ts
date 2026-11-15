import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Airports')
@Public()
@Controller('airports')
export class AirportsController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @ApiOperation({ summary: 'Search read-only airport data' })
  async search(
    @Query('q') query = '',
    @Query('country') country = '',
    @Query('page') pageText = '1',
    @Query('limit') limitText = '20',
  ) {
    const page = Number(pageText);
    const limit = Number(limitText);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new BadRequestException('Invalid airport pagination');
    }
    if (query.length > 100 || (country && !/^[A-Za-z]{2}$/.test(country))) {
      throw new BadRequestException('Invalid airport search filters');
    }
    if (!this.connection.db)
      throw new Error('Database connection is unavailable');
    const filter: Record<string, unknown> = {};
    if (country) filter.country_code = country.toUpperCase();
    if (query.trim()) {
      const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { iata_code: { $regex: '^' + escaped, $options: 'i' } },
        { name: { $regex: escaped, $options: 'i' } },
      ];
    }
    const collection = this.connection.db.collection('airports');
    const [airports, total] = await Promise.all([
      collection
        .find(filter, { projection: { _id: 0 } })
        .sort({ name: 1, iata_code: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);
    return {
      airports,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  @Get(':code')
  @ApiOperation({
    summary: 'Read an airport and its IANA time zone by IATA code',
  })
  async findOne(@Param('code') code: string) {
    const normalized = code.toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized))
      throw new BadRequestException('Invalid IATA airport code');
    if (!this.connection.db)
      throw new Error('Database connection is unavailable');
    const airport = await this.connection.db
      .collection('airports')
      .findOne({ iata_code: normalized }, { projection: { _id: 0 } });
    if (!airport) throw new NotFoundException('Airport not found');
    return airport;
  }
}
