
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
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
import { UpdateFlightDto } from './dto/update-flight.dto';

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

  private async getAirport(
    code: string,
  ): Promise<AirportRecord> {
    const database = this.connection.db;

    if (!database) {
      throw new BadRequestException(
        'Database connection is unavailable',
      );
    }

    const airport = await database
      .collection<AirportRecord>('airports')
      .findOne({ iata_code: code });

    if (!airport) {
      throw new BadRequestException(
        `Airport ${code} does not exist`,
      );
    }

    return airport;
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

    const [departureAirport, arrivalAirport] =
      await Promise.all([
        this.getAirport(dto.departureAirport),
        this.getAirport(dto.arrivalAirport),
      ]);

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
      if (cabin.availableSeats !== cabin.totalSeats) {
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
      if (
        query.returnPage !== undefined ||
        query.returnLimit !== undefined
      ) {
        throw new BadRequestException(
          'Return pagination requires returnDate',
        );
      }

      return this.searchLeg(query, now);
    }

    const {
      departureAirport,
      arrivalAirport,
      departureDate,
      returnDate,
    } = query;

    if (
      !departureAirport ||
      !arrivalAirport ||
      !departureDate ||
      !returnDate
    ) {
      throw new BadRequestException(
        'Round-trip search requires departureAirport, arrivalAirport, departureDate and returnDate',
      );
    }

    if (departureAirport === arrivalAirport) {
      throw new BadRequestException(
        'Departure and arrival airports must be different',
      );
    }

    for (const date of [departureDate, returnDate]) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !DateTime.fromISO(date, { zone: 'utc' }).isValid
      ) {
        throw new BadRequestException(
          'Dates must be valid calendar dates in YYYY-MM-DD format',
        );
      }
    }

    if (returnDate < departureDate) {
      throw new BadRequestException(
        'Return date cannot be before departure date',
      );
    }

    const [outbound, inbound] = await Promise.all([
      this.searchLeg(query, now),
      this.searchLeg(
        {
          departureAirport: arrivalAirport,
          arrivalAirport: departureAirport,
          departureDate: returnDate,
          cabinClass: query.cabinClass,
          passengers: query.passengers,
          page: query.returnPage ?? 1,
          limit: query.returnLimit ?? query.limit ?? 10,
        },
        now,
      ),
    ]);

    return { outbound, inbound };
  }

  private async searchLeg(
    query: SearchFlightsDto,
    now: Date,
  ) {
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

    if (departureDate) {
      if (!departureAirport) {
        throw new BadRequestException(
          'Departure airport is required when searching by local departure date',
        );
      }

      const airport = await this.getAirport(
        departureAirport,
      );

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

      const localEnd = localStart
        .plus({ days: 1 })
        .startOf('day');

      filter.departureTimeUtc = {
        $gt: now,
        $gte: localStart.toUTC().toJSDate(),
        $lt: localEnd.toUTC().toJSDate(),
      };
    }

    filter.cabins = {
      $elemMatch: {
        ...(cabinClass ? { cabinClass } : {}),
        availableSeats: { $gte: passengers },
      },
    };

    const skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
      throw new BadRequestException(
        'Page offset is too large',
      );
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

  async update(id: string, dto: UpdateFlightDto) {
    const flight = await this.findOne(id);

    if (flight.status !== FlightStatus.SCHEDULED) {
      throw new BadRequestException(
        'Only scheduled flights can be updated',
      );
    }

    if (flight.departureTimeUtc <= new Date()) {
      throw new BadRequestException(
        'Flights that have reached their departure time cannot be updated',
      );
    }

    const newDepartureAirport =
      dto.departureAirport ?? flight.departureAirport;

    const newArrivalAirport =
      dto.arrivalAirport ?? flight.arrivalAirport;

    if (newDepartureAirport === newArrivalAirport) {
      throw new BadRequestException(
        'Departure and arrival airports must be different',
      );
    }

    const departureAirportChanged =
      newDepartureAirport !== flight.departureAirport;

    const arrivalAirportChanged =
      newArrivalAirport !== flight.arrivalAirport;

    if (
      departureAirportChanged &&
      !dto.departureLocalTime
    ) {
      throw new BadRequestException(
        'departureLocalTime is required when changing the departure airport',
      );
    }

    if (
      arrivalAirportChanged &&
      !dto.arrivalLocalTime
    ) {
      throw new BadRequestException(
        'arrivalLocalTime is required when changing the arrival airport',
      );
    }

    const scheduleOrRouteChanged =
      departureAirportChanged ||
      arrivalAirportChanged ||
      dto.departureLocalTime !== undefined ||
      dto.arrivalLocalTime !== undefined ||
      dto.airlineId !== undefined;

    const hasAllocatedSeats = flight.cabins.some(
      (cabin) =>
        cabin.availableSeats !== cabin.totalSeats,
    );

    if (
      scheduleOrRouteChanged &&
      hasAllocatedSeats
    ) {
      throw new BadRequestException(
        'Cannot change route, schedule or airline after seats have been allocated',
      );
    }

    if (dto.airlineId !== undefined) {
      const airline = await this.airlineModel
        .findById(dto.airlineId)
        .exec();

      if (!airline) {
        throw new NotFoundException('Airline not found');
      }

      if (!airline.isActive) {
        throw new BadRequestException(
          'Airline is inactive',
        );
      }

      flight.airlineId = new Types.ObjectId(
        dto.airlineId,
      );
    }

    const [departureAirport, arrivalAirport] =
      await Promise.all([
        this.getAirport(newDepartureAirport),
        this.getAirport(newArrivalAirport),
      ]);

    const existingDepartureLocal = DateTime
      .fromJSDate(flight.departureTimeUtc, {
        zone: flight.departureTimeZone,
      })
      .toFormat("yyyy-MM-dd'T'HH:mm:ss");

    const existingArrivalLocal = DateTime
      .fromJSDate(flight.arrivalTimeUtc, {
        zone: flight.arrivalTimeZone,
      })
      .toFormat("yyyy-MM-dd'T'HH:mm:ss");

    const departure = this.convertLocalTimeToUtc(
      dto.departureLocalTime ??
        existingDepartureLocal,
      departureAirport.time_zone,
    );

    const arrival = this.convertLocalTimeToUtc(
      dto.arrivalLocalTime ?? existingArrivalLocal,
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

    if (dto.cabins !== undefined) {
      if (dto.cabins.length === 0) {
        throw new BadRequestException(
          'Cabin updates cannot be empty',
        );
      }

      const cabinClasses = dto.cabins.map(
        (cabin) => cabin.cabinClass,
      );

      if (
        new Set(cabinClasses).size !==
        cabinClasses.length
      ) {
        throw new BadRequestException(
          'Duplicate cabin classes are not allowed',
        );
      }

      for (const update of dto.cabins) {
        const existingCabin = flight.cabins.find(
          (cabin) =>
            cabin.cabinClass === update.cabinClass,
        );

        if (!existingCabin) {
          throw new BadRequestException(
            `Cabin class ${update.cabinClass} does not exist on this flight`,
          );
        }

        if (update.price !== undefined) {
          existingCabin.price = update.price;
        }

        if (
          update.baggageAllowanceKg !== undefined
        ) {
          existingCabin.baggageAllowanceKg =
            update.baggageAllowanceKg;
        }

        if (
          update.extraBaggagePricePerKg !==
          undefined
        ) {
          existingCabin.extraBaggagePricePerKg =
            update.extraBaggagePricePerKg;
        }
      }
    }

    if (dto.flightNumber !== undefined) {
      flight.flightNumber = dto.flightNumber;
    }

    flight.departureAirport = newDepartureAirport;
    flight.arrivalAirport = newArrivalAirport;
    flight.departureTimeUtc = departure;
    flight.arrivalTimeUtc = arrival;
    flight.departureTimeZone =
      departureAirport.time_zone;
    flight.arrivalTimeZone =
      arrivalAirport.time_zone;

    return flight.save();
  }

  async cancel(id: string) {
    const flight = await this.findOne(id);

    if (flight.status !== FlightStatus.SCHEDULED) {
      throw new BadRequestException(
        'Only scheduled flights can be cancelled',
      );
    }

    if (flight.departureTimeUtc <= new Date()) {
      throw new BadRequestException(
        'Flights that have reached their departure time cannot be cancelled',
      );
    }

    const hasAllocatedSeats = flight.cabins.some(
      (cabin) =>
        cabin.availableSeats !== cabin.totalSeats,
    );

    if (hasAllocatedSeats) {
      throw new BadRequestException(
        'Cannot cancel a flight with allocated seats until booking and refund handling is integrated',
      );
    }

    // Check status, departure time and cabin inventory
    // again within the same database update operation.
    const cancelledFlight = await this.flightModel
      .findOneAndUpdate(
        {
          _id: flight._id,
          status: FlightStatus.SCHEDULED,
          departureTimeUtc: { $gt: new Date() },
          $expr: {
            $allElementsTrue: [
              {
                $map: {
                  input: '$cabins',
                  as: 'cabin',
                  in: {
                    $eq: [
                      '$$cabin.availableSeats',
                      '$$cabin.totalSeats',
                    ],
                  },
                },
              },
            ],
          },
        },
        {
          $set: {
            status: FlightStatus.CANCELLED,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
      .exec();

    if (!cancelledFlight) {
      throw new BadRequestException(
        'Flight could not be cancelled because its state changed',
      );
    }

    return cancelledFlight;
  }
}
