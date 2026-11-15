
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InjectConnection,
  InjectModel,
} from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';

import {
  Flight,
  FlightDocument,
  FlightStatus,
} from './schemas/flight.schema';

import {
  Airline,
  AirlineDocument,
} from '../airlines/schemas/airline.schema';

import { CreateFlightDto } from './dto/create-flight.dto';
import { SearchFlightsDto } from './dto/search-flights.dto';

type AirportRecord = {
  iata_code: string;
  time_zone: string;
};

type FlightSearchFilter = {
  status: FlightStatus;
  departureTimeUtc: {
    $gt?: Date;
    $gte?: Date;
    $lt?: Date;
  };
  departureAirport?: string;
  arrivalAirport?: string;
  /** ACC-15: only flights from active airlines appear in search. */
  airlineId?: { $in: Types.ObjectId[] };
  cabins?: {
    $elemMatch: {
      cabinClass?: string;
      availableSeats: { $gte: number };
    };
  };
};

@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Flight.name)
    private readonly flightModel: Model<FlightDocument>,

    @InjectModel(Airline.name)
    private readonly airlineModel: Model<AirlineDocument>,

    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private convertLocalTimeToUtc(
    localTime: string,
    timeZone: string,
  ): Date {
    const local = DateTime.fromISO(localTime, {
      zone: timeZone,
      setZone: true,
    });

    if (!local.isValid) {
      throw new BadRequestException(
        `Invalid local date/time or time zone: ${localTime} (${timeZone})`,
      );
    }

    if (
      local.toFormat("yyyy-MM-dd'T'HH:mm:ss") !== localTime
    ) {
      throw new BadRequestException(
        `Nonexistent local time: ${localTime} (${timeZone})`,
      );
    }

    if (local.getPossibleOffsets().length !== 1) {
      throw new BadRequestException(
        `Ambiguous local time: ${localTime} (${timeZone})`,
      );
    }

    return local.toUTC().toJSDate();
  }

  async create(dto: CreateFlightDto) {
    const airline = await this.airlineModel
      .findById(dto.airlineId)
      .exec();

    if (!airline) {
      throw new NotFoundException('Airline not found');
    }

    if (!airline.isActive) {
      throw new BadRequestException('Airline is inactive');
    }

    if (dto.departureAirport === dto.arrivalAirport) {
      throw new BadRequestException(
        'Departure and arrival airports must be different',
      );
    }

    const database = this.connection.db;

    if (!database) {
      throw new BadRequestException(
        'Database connection is unavailable',
      );
    }

    const airports =
      database.collection<AirportRecord>('airports');

    const [departureAirport, arrivalAirport] =
      await Promise.all([
        airports.findOne({
          iata_code: dto.departureAirport,
        }),
        airports.findOne({
          iata_code: dto.arrivalAirport,
        }),
      ]);

    if (!departureAirport || !arrivalAirport) {
      throw new BadRequestException(
        'Departure or arrival airport does not exist',
      );
    }

    const departure = this.convertLocalTimeToUtc(
      dto.departureLocalTime,
      departureAirport.time_zone,
    );

    const arrival = this.convertLocalTimeToUtc(
      dto.arrivalLocalTime,
      arrivalAirport.time_zone,
    );

    if (departure <= new Date()) {
      throw new BadRequestException(
        'Departure must be in the future',
      );
    }

    if (arrival <= departure) {
      throw new BadRequestException(
        'Arrival must be after departure',
      );
    }

    const cabinClasses = dto.cabins.map(
      (cabin) => cabin.cabinClass,
    );

    if (
      new Set(cabinClasses).size !== cabinClasses.length
    ) {
      throw new BadRequestException(
        'Duplicate cabin classes are not allowed',
      );
    }

    for (const cabin of dto.cabins) {
      if (
        cabin.availableSeats !== cabin.totalSeats
      ) {
        throw new BadRequestException(
          'Available seats must initially equal total seats',
        );
      }
    }

    const flight = new this.flightModel({
      airlineId: new Types.ObjectId(dto.airlineId),
      flightNumber: dto.flightNumber,
      departureAirport: dto.departureAirport,
      arrivalAirport: dto.arrivalAirport,
      departureTimeUtc: departure,
      arrivalTimeUtc: arrival,
      departureTimeZone: departureAirport.time_zone,
      arrivalTimeZone: arrivalAirport.time_zone,
      cabins: dto.cabins.map((cabin) => ({
        ...cabin,
        availableSeats: cabin.totalSeats,
      })),
      status: FlightStatus.SCHEDULED,
    });

    return flight.save();
  }

  async searchFlights(query: SearchFlightsDto) {
    const now = new Date();
    if (query.returnDate === undefined) {
      if (query.returnPage !== undefined || query.returnLimit !== undefined) {
        throw new BadRequestException('Return pagination requires returnDate');
      }
      return this.searchLeg(query, now);
    }

    const { departureAirport, arrivalAirport, departureDate, returnDate } = query;
    if (!departureAirport || !arrivalAirport || !departureDate || !returnDate) {
      throw new BadRequestException(
        'Round-trip search requires departureAirport, arrivalAirport, departureDate and returnDate',
      );
    }
    if (departureAirport === arrivalAirport) {
      throw new BadRequestException('Departure and arrival airports must be different');
    }
    for (const date of [departureDate, returnDate]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !DateTime.fromISO(date, { zone: 'utc' }).isValid) {
        throw new BadRequestException('Dates must be valid calendar dates in YYYY-MM-DD format');
      }
    }
    if (returnDate < departureDate) {
      throw new BadRequestException('Return date cannot be before departure date');
    }

    const [outbound, inbound] = await Promise.all([
      this.searchLeg(query, now),
      this.searchLeg({
        departureAirport: arrivalAirport,
        arrivalAirport: departureAirport,
        departureDate: returnDate,
        cabinClass: query.cabinClass,
        passengers: query.passengers,
        page: query.returnPage ?? 1,
        limit: query.returnLimit ?? query.limit ?? 10,
      }, now),
    ]);
    return { outbound, inbound };
  }

  private async searchLeg(query: SearchFlightsDto, now: Date) {
    const {
      departureAirport,
      arrivalAirport,
      departureDate,
      cabinClass,
      passengers = 1,
      page = 1,
      limit = 10,
    } = query;

    if (
      !Number.isSafeInteger(passengers) ||
      passengers < 1 ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new BadRequestException(
        'Invalid search pagination or passenger count',
      );
    }

    const filter: FlightSearchFilter = {
      status: FlightStatus.SCHEDULED,
      departureTimeUtc: { $gt: now },
    };

    if (departureAirport) {
      filter.departureAirport = departureAirport;
    }

    if (arrivalAirport) {
      filter.arrivalAirport = arrivalAirport;
    }

    // Search by the departure airport's local date.
    if (departureDate) {
      if (!departureAirport) {
        throw new BadRequestException(
          'Departure airport is required when searching by local departure date',
        );
      }

      const database = this.connection.db;

      if (!database) {
        throw new BadRequestException(
          'Database connection is unavailable',
        );
      }

      const airport = await database
        .collection<AirportRecord>('airports')
        .findOne({
          iata_code: departureAirport,
        });

      if (!airport) {
        throw new BadRequestException(
          'Departure airport does not exist',
        );
      }

      const localStart = DateTime.fromISO(
        `${departureDate}T00:00:00`,
        { zone: airport.time_zone },
      );

      if (
        !localStart.isValid ||
        localStart.toFormat('yyyy-MM-dd') !==
          departureDate
      ) {
        throw new BadRequestException(
          'Invalid departure date',
        );
      }

      const localEnd = localStart.plus({ days: 1 }).startOf('day');

      const start = localStart.toUTC().toJSDate();
      const end = localEnd.toUTC().toJSDate();

      filter.departureTimeUtc = {
        $gt: now,
        $gte: start,
        $lt: end,
      };
    }

    filter.cabins = {
      $elemMatch: {
        ...(cabinClass ? { cabinClass } : {}),
        availableSeats: {
          $gte: passengers,
        },
      },
    };

    // ACC-15: deactivated airlines are hidden from flight search.
    const activeAirlineIds = await this.airlineModel
      .find({ isActive: true })
      .distinct('_id')
      .exec();
    filter.airlineId = { $in: activeAirlineIds };

    const skip = (page - 1) * limit;
    if (!Number.isSafeInteger(skip)) {
      throw new BadRequestException('Page offset is too large');
    }

    const [flights, total] = await Promise.all([
      this.flightModel
        .find(filter)
        .sort({
          departureTimeUtc: 1,
          _id: 1,
        })
        .skip(skip)
        .limit(limit)
        .exec(),

      this.flightModel
        .countDocuments(filter)
        .exec(),
    ]);

    return {
      flights,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(
        'Invalid flight ID',
      );
    }

    const flight = await this.flightModel
      .findById(id)
      .exec();

    if (!flight) {
      throw new NotFoundException(
        'Flight not found',
      );
    }

    return flight;
  }
}

