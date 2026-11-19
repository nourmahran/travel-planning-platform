import { Cron } from '@nestjs/schedule';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';

import { Flight, FlightDocument, FlightStatus } from './schemas/flight.schema';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { CreateFlightDto } from './dto/create-flight.dto';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { CabinDetailsDto } from './dto/cabin-details.dto';
import { BookingStatus } from '../bookings/schemas/booking.schema';
import { notificationRecord } from '../common/notification-record';
import { randomUUID } from 'node:crypto';

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
  airlineId?: { $in: Types.ObjectId[] };
  cabins?: {
    $elemMatch: {
      cabinClass?: string;
      availableSeats: { $gte: number };
      price?: { $gte?: number; $lte?: number };
    };
  };
};

@Injectable()
export class FlightsService {
  @Cron('*/15 * * * * *', { name: 'depart-flights', waitForCompletion: true })
  async markDepartedFlights(now = new Date()) {
    return this.flightModel
      .updateMany(
        { status: FlightStatus.SCHEDULED, departureTimeUtc: { $lte: now } },
        { $set: { status: FlightStatus.DEPARTED } },
      )
      .exec();
  }

  constructor(
    @InjectModel(Flight.name)
    private readonly flightModel: Model<FlightDocument>,

    @InjectModel(Airline.name)
    private readonly airlineModel: Model<AirlineDocument>,

    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private convertLocalTimeToUtc(localTime: string, timeZone: string): Date {
    const local = DateTime.fromISO(localTime, {
      zone: timeZone,
      setZone: true,
    });

    if (!local.isValid) {
      throw new BadRequestException(
        `Invalid local date/time or time zone: ${localTime} (${timeZone})`,
      );
    }

    if (local.toFormat("yyyy-MM-dd'T'HH:mm:ss") !== localTime) {
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

  private async getAirport(code: string): Promise<AirportRecord> {
    const database = this.connection.db;

    if (!database) {
      throw new BadRequestException('Database connection is unavailable');
    }

    const airport = await database
      .collection<AirportRecord>('airports')
      .findOne({ iata_code: code });

    if (!airport) {
      throw new BadRequestException(`Airport ${code} does not exist`);
    }

    return airport;
  }

  async create(dto: CreateFlightDto) {
    const airline = await this.airlineModel.findById(dto.airlineId).exec();

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

    const [departureAirport, arrivalAirport] = await Promise.all([
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
      throw new BadRequestException('Departure must be in the future');
    }

    if (arrival <= departure) {
      throw new BadRequestException('Arrival must be after departure');
    }

    const cabinClasses = dto.cabins.map((cabin) => cabin.cabinClass);

    if (new Set(cabinClasses).size !== cabinClasses.length) {
      throw new BadRequestException('Duplicate cabin classes are not allowed');
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
      departureLocalDate: dto.departureLocalTime.slice(0, 10),
      arrivalTimeUtc: arrival,
      departureTimeZone: departureAirport.time_zone,
      arrivalTimeZone: arrivalAirport.time_zone,
      cabins: dto.cabins.map((cabin) => ({
        cabinClass: cabin.cabinClass,
        price: cabin.price,
        totalSeats: cabin.totalSeats,
        baggageAllowanceKg: cabin.baggageAllowanceKg,
        extraBaggagePricePerKg: cabin.extraBaggagePricePerKg,
        freeBagsPerPassenger: cabin.freeBagsPerPassenger,
        maxWeightKgPerBag: cabin.maxWeightKgPerBag,
        extraBagPrice: cabin.extraBagPrice,
        maxExtraBagsPerPassenger: cabin.maxExtraBagsPerPassenger,
        availableSeats: cabin.totalSeats,
      })),
      status: FlightStatus.SCHEDULED,
    });

    try {
      return await flight.save();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(
          'Flight number already exists for this airline and departure date',
        );
      }
      throw error;
    }
  }

  async searchFlights(query: SearchFlightsDto) {
    const now = new Date();

    if (query.returnDate === undefined) {
      if (query.returnPage !== undefined || query.returnLimit !== undefined) {
        throw new BadRequestException('Return pagination requires returnDate');
      }

      return this.searchLeg(query, now);
    }

    const { departureAirport, arrivalAirport, departureDate, returnDate } =
      query;

    if (!departureAirport || !arrivalAirport || !departureDate || !returnDate) {
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
          minPrice: query.minPrice,
          maxPrice: query.maxPrice,
          sortBy: query.sortBy,
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

    const { minPrice, maxPrice, sortBy = 'departure' } = query;
    if (
      [minPrice, maxPrice].some(
        (p) => p !== undefined && (!Number.isFinite(p) || p < 0),
      ) ||
      (minPrice !== undefined &&
        maxPrice !== undefined &&
        minPrice > maxPrice) ||
      ![
        'departure',
        'price_asc',
        'price_desc',
        'duration_asc',
        'duration_desc',
      ].includes(sortBy)
    ) {
      throw new BadRequestException('Invalid price range or sort order');
    }
    const price = {
      ...(minPrice !== undefined ? { $gte: minPrice } : {}),
      ...(maxPrice !== undefined ? { $lte: maxPrice } : {}),
    };

    const filter: FlightSearchFilter = {
      status: FlightStatus.SCHEDULED,
      departureTimeUtc: { $gt: now },
    };

    await Promise.all([
      departureAirport ? this.getAirport(departureAirport) : Promise.resolve(),
      arrivalAirport ? this.getAirport(arrivalAirport) : Promise.resolve(),
    ]);
    const activeAirlines = await this.airlineModel
      .find({ isActive: true })
      .select('_id')
      .exec();
    filter.airlineId = { $in: activeAirlines.map((airline) => airline._id) };

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

      const airport = await this.getAirport(departureAirport);

      const localStart = DateTime.fromISO(`${departureDate}T00:00:00`, {
        zone: airport.time_zone,
      });

      if (
        !localStart.isValid ||
        localStart.toFormat('yyyy-MM-dd') !== departureDate
      ) {
        throw new BadRequestException('Invalid departure date');
      }

      const localEnd = localStart.plus({ days: 1 }).startOf('day');

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
        ...(Object.keys(price).length ? { price } : {}),
      },
    };

    const skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
      throw new BadRequestException('Page offset is too large');
    }

    if (sortBy !== 'departure') {
      const sortField = sortBy.startsWith('duration')
        ? 'durationMinutes'
        : 'matchingPrice';
      const sortDirection: 1 | -1 = sortBy.endsWith('_asc') ? 1 : -1;
      const conditions: object[] = [
        { $gte: ['$$c.availableSeats', passengers] },
      ];
      if (cabinClass) conditions.push({ $eq: ['$$c.cabinClass', cabinClass] });
      if (minPrice !== undefined)
        conditions.push({ $gte: ['$$c.price', minPrice] });
      if (maxPrice !== undefined)
        conditions.push({ $lte: ['$$c.price', maxPrice] });
      const [result] = await this.flightModel
        .aggregate([
          { $match: filter },
          {
            $set: {
              matchingPrice: {
                $min: {
                  $map: {
                    input: {
                      $filter: {
                        input: '$cabins',
                        as: 'c',
                        cond: { $and: conditions },
                      },
                    },
                    as: 'c',
                    in: '$$c.price',
                  },
                },
              },
              durationMinutes: {
                $divide: [
                  { $subtract: ['$arrivalTimeUtc', '$departureTimeUtc'] },
                  60000,
                ],
              },
            },
          },
          {
            $facet: {
              flights: [
                {
                  $sort: {
                    [sortField]: sortDirection,
                    departureTimeUtc: 1,
                    _id: 1,
                  },
                },
                { $skip: skip },
                { $limit: limit },
              ],
              count: [{ $count: 'total' }],
            },
          },
        ])
        .exec();
      const total = result?.count[0]?.total ?? 0;
      return {
        flights: result?.flights ?? [],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
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

      this.flightModel.countDocuments(filter).exec(),
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
      throw new BadRequestException('Invalid flight ID');
    }

    const flight = await this.flightModel.findById(id).exec();

    if (!flight) {
      throw new NotFoundException('Flight not found');
    }

    return flight;
  }

  async details(id: string) {
    const flight = await this.findOne(id);
    const airline = await this.airlineModel.findById(flight.airlineId).exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return {
      flight,
      airline: {
        id: airline._id,
        name: airline.name,
        code: airline.code,
        logoUrl: airline.logoUrl,
      },
      departureLocalTime: DateTime.fromJSDate(flight.departureTimeUtc, {
        zone: flight.departureTimeZone,
      }).toISO(),
      arrivalLocalTime: DateTime.fromJSDate(flight.arrivalTimeUtc, {
        zone: flight.arrivalTimeZone,
      }).toISO(),
      durationMinutes: Math.round(
        (flight.arrivalTimeUtc.getTime() - flight.departureTimeUtc.getTime()) /
          60000,
      ),
      cancellationTiers: airline.flightPolicies?.cancellationTiers ?? [],
    };
  }

  /** FLT-04: add a new cabin class to an existing scheduled flight. */
  async addCabin(id: string, cabin: CabinDetailsDto) {
    if (cabin.availableSeats !== cabin.totalSeats) {
      throw new BadRequestException(
        'Available seats must initially equal total seats',
      );
    }
    const updated = await this.flightModel
      .findOneAndUpdate(
        {
          _id: id,
          status: FlightStatus.SCHEDULED,
          'cabins.cabinClass': { $ne: cabin.cabinClass },
        },
        {
          $push: {
            cabins: {
              cabinClass: cabin.cabinClass,
              price: cabin.price,
              totalSeats: cabin.totalSeats,
              availableSeats: cabin.totalSeats,
              baggageAllowanceKg: cabin.baggageAllowanceKg,
              extraBaggagePricePerKg: cabin.extraBaggagePricePerKg,
              freeBagsPerPassenger: cabin.freeBagsPerPassenger,
              maxWeightKgPerBag: cabin.maxWeightKgPerBag,
              extraBagPrice: cabin.extraBagPrice,
              maxExtraBagsPerPassenger: cabin.maxExtraBagsPerPassenger,
            },
          },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (updated) return updated;
    const flight = await this.findOne(id);
    if (flight.status !== FlightStatus.SCHEDULED) {
      throw new BadRequestException('Only scheduled flights can get new cabins');
    }
    throw new ConflictException(
      `Cabin class ${cabin.cabinClass} already exists on this flight`,
    );
  }

  async update(id: string, dto: UpdateFlightDto) {
    const flight = await this.findOne(id);

    const capacityUpdates =
      dto.cabins?.filter((cabin) => cabin.totalSeats !== undefined) ?? [];
    if (capacityUpdates.length) {
      if (
        capacityUpdates.length !== 1 ||
        dto.cabins?.length !== 1 ||
        Object.keys(dto).some((key) => key !== 'cabins') ||
        Object.keys(capacityUpdates[0]).some(
          (key) => key !== 'cabinClass' && key !== 'totalSeats',
        )
      ) {
        throw new BadRequestException(
          'Change one cabin seat count at a time, separately from other edits',
        );
      }
      if (
        flight.status !== FlightStatus.SCHEDULED ||
        flight.departureTimeUtc <= new Date()
      ) {
        throw new BadRequestException(
          'Only future scheduled flights can be updated',
        );
      }
      const change = capacityUpdates[0];
      const cabin = flight.cabins.find(
        (item) => item.cabinClass === change.cabinClass,
      );
      if (!cabin)
        throw new BadRequestException(
          'Cabin class does not exist on this flight',
        );
      const delta = change.totalSeats! - cabin.totalSeats;
      if (cabin.availableSeats + delta < 0) {
        throw new BadRequestException(
          'Seat count cannot fall below held or booked seats',
        );
      }
      if (delta === 0) return flight;
      const updated = await this.flightModel
        .findOneAndUpdate(
          {
            _id: flight._id,
            status: FlightStatus.SCHEDULED,
            departureTimeUtc: { $gt: new Date() },
            cabins: {
              $elemMatch: {
                cabinClass: change.cabinClass,
                totalSeats: cabin.totalSeats,
                availableSeats: cabin.availableSeats,
              },
            },
          },
          {
            $inc: {
              'cabins.$.totalSeats': delta,
              'cabins.$.availableSeats': delta,
            },
          },
          { new: true, runValidators: true },
        )
        .exec();
      if (!updated)
        throw new ConflictException(
          'Flight inventory changed; retry the seat count edit',
        );
      return updated;
    }

    if (flight.status !== FlightStatus.SCHEDULED) {
      throw new BadRequestException('Only scheduled flights can be updated');
    }

    if (flight.departureTimeUtc <= new Date()) {
      throw new BadRequestException(
        'Flights that have reached their departure time cannot be updated',
      );
    }

    const newDepartureAirport = dto.departureAirport ?? flight.departureAirport;

    const newArrivalAirport = dto.arrivalAirport ?? flight.arrivalAirport;

    if (newDepartureAirport === newArrivalAirport) {
      throw new BadRequestException(
        'Departure and arrival airports must be different',
      );
    }

    const departureAirportChanged =
      newDepartureAirport !== flight.departureAirport;

    const arrivalAirportChanged = newArrivalAirport !== flight.arrivalAirport;

    if (departureAirportChanged && !dto.departureLocalTime) {
      throw new BadRequestException(
        'departureLocalTime is required when changing the departure airport',
      );
    }

    if (arrivalAirportChanged && !dto.arrivalLocalTime) {
      throw new BadRequestException(
        'arrivalLocalTime is required when changing the arrival airport',
      );
    }

    const routeOrAirlineChanged =
      departureAirportChanged ||
      arrivalAirportChanged ||
      dto.airlineId !== undefined;

    const hasAllocatedSeats = flight.cabins.some(
      (cabin) => cabin.availableSeats !== cabin.totalSeats,
    );

    if (routeOrAirlineChanged && hasAllocatedSeats) {
      throw new BadRequestException(
        'Cannot change route or airline after seats have been allocated',
      );
    }

    const requestedTimeChange =
      dto.departureLocalTime !== undefined ||
      dto.arrivalLocalTime !== undefined;
    if (
      hasAllocatedSeats &&
      requestedTimeChange &&
      Object.keys(dto).some(
        (key) => key !== 'departureLocalTime' && key !== 'arrivalLocalTime',
      )
    ) {
      throw new BadRequestException(
        'Change booked flight times separately from other edits',
      );
    }

    if (dto.airlineId !== undefined) {
      const airline = await this.airlineModel.findById(dto.airlineId).exec();

      if (!airline) {
        throw new NotFoundException('Airline not found');
      }

      if (!airline.isActive) {
        throw new BadRequestException('Airline is inactive');
      }

      flight.airlineId = new Types.ObjectId(dto.airlineId);
    }

    const [departureAirport, arrivalAirport] = await Promise.all([
      this.getAirport(newDepartureAirport),
      this.getAirport(newArrivalAirport),
    ]);

    const existingDepartureLocal = DateTime.fromJSDate(
      flight.departureTimeUtc,
      {
        zone: flight.departureTimeZone,
      },
    ).toFormat("yyyy-MM-dd'T'HH:mm:ss");

    const existingArrivalLocal = DateTime.fromJSDate(flight.arrivalTimeUtc, {
      zone: flight.arrivalTimeZone,
    }).toFormat("yyyy-MM-dd'T'HH:mm:ss");

    const departure = this.convertLocalTimeToUtc(
      dto.departureLocalTime ?? existingDepartureLocal,
      departureAirport.time_zone,
    );

    const arrival = this.convertLocalTimeToUtc(
      dto.arrivalLocalTime ?? existingArrivalLocal,
      arrivalAirport.time_zone,
    );

    if (departure <= new Date()) {
      throw new BadRequestException('Departure must be in the future');
    }

    if (arrival <= departure) {
      throw new BadRequestException('Arrival must be after departure');
    }

    if (dto.cabins !== undefined) {
      if (dto.cabins.length === 0) {
        throw new BadRequestException('Cabin updates cannot be empty');
      }

      const cabinClasses = dto.cabins.map((cabin) => cabin.cabinClass);

      if (new Set(cabinClasses).size !== cabinClasses.length) {
        throw new BadRequestException(
          'Duplicate cabin classes are not allowed',
        );
      }

      for (const update of dto.cabins) {
        const existingCabin = flight.cabins.find(
          (cabin) => cabin.cabinClass === update.cabinClass,
        );

        if (!existingCabin) {
          throw new BadRequestException(
            `Cabin class ${update.cabinClass} does not exist on this flight`,
          );
        }

        if (update.price !== undefined) {
          existingCabin.price = update.price;
        }

        if (update.baggageAllowanceKg !== undefined) {
          existingCabin.baggageAllowanceKg = update.baggageAllowanceKg;
        }

        if (update.extraBaggagePricePerKg !== undefined) {
          existingCabin.extraBaggagePricePerKg = update.extraBaggagePricePerKg;
        }
      }
    }

    if (dto.flightNumber !== undefined) {
      flight.flightNumber = dto.flightNumber;
    }

    const oldDepartureTime = flight.departureTimeUtc;
    const oldArrivalTime = flight.arrivalTimeUtc;
    flight.departureAirport = newDepartureAirport;
    flight.arrivalAirport = newArrivalAirport;
    flight.departureTimeUtc = departure;
    flight.departureLocalDate = DateTime.fromJSDate(departure, {
      zone: departureAirport.time_zone,
    }).toISODate()!;
    flight.arrivalTimeUtc = arrival;
    flight.departureTimeZone = departureAirport.time_zone;
    flight.arrivalTimeZone = arrivalAirport.time_zone;

    const timeChanged =
      departure.getTime() !== oldDepartureTime.getTime() ||
      arrival.getTime() !== oldArrivalTime.getTime();

    if (hasAllocatedSeats && timeChanged) {
      const scheduleEventId = randomUUID();
      const session = await this.connection.startSession();
      try {
        let updated: FlightDocument | null = null;
        await session.withTransaction(async () => {
          updated = await this.flightModel
            .findOneAndUpdate(
              {
                _id: flight._id,
                status: FlightStatus.SCHEDULED,
                departureTimeUtc: oldDepartureTime,
                arrivalTimeUtc: oldArrivalTime,
              },
              {
                $set: {
                  departureTimeUtc: departure,
                  arrivalTimeUtc: arrival,
                  departureLocalDate: flight.departureLocalDate,
                },
              },
              { new: true, runValidators: true, session },
            )
            .exec();
          if (!updated)
            throw new ConflictException(
              'Flight schedule changed; retry the edit',
            );
          const bookings = await this.connection
            .collection('bookings')
            .find(
              {
                $or: [{ flightId: flight._id }, { returnFlightId: flight._id }],
                status: BookingStatus.CONFIRMED,
              },
              { session },
            )
            .toArray();
          if (bookings.length) {
            await this.connection.collection('notifications').insertMany(
              bookings.map((booking) =>
                notificationRecord({
                  recipientId: booking.userId as string,
                  eventId: `flight:schedule:${scheduleEventId}:${booking._id.toString()}`,
                  type: 'flight.schedule_changed',
                  title: 'Flight schedule changed',
                  message: `Flight ${flight.flightNumber} now departs ${departure.toISOString()} UTC and arrives ${arrival.toISOString()} UTC.`,
                  link: `/bookings/${booking._id.toString()}`,
                }),
              ),
              { session },
            );
          }
        });
        return updated;
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          throw new ConflictException(
            'Flight number already exists for this airline and departure date',
          );
        }
        throw error;
      } finally {
        await session.endSession();
      }
    }

    try {
      return await flight.save();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(
          'Flight number already exists for this airline and departure date',
        );
      }
      throw error;
    }
  }

  async cancel(id: string) {
    const flight = await this.findOne(id);

    if (flight.status !== FlightStatus.SCHEDULED) {
      throw new BadRequestException('Only scheduled flights can be cancelled');
    }

    if (flight.departureTimeUtc <= new Date()) {
      throw new BadRequestException(
        'Flights that have reached their departure time cannot be cancelled',
      );
    }

    const hasAllocatedSeats = flight.cabins.some(
      (cabin) => cabin.availableSeats !== cabin.totalSeats,
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
                    $eq: ['$$cabin.availableSeats', '$$cabin.totalSeats'],
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
