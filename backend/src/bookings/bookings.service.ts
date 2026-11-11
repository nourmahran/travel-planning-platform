import { passengerCsv, ticketPdf } from './booking-exports';
import { Cron } from '@nestjs/schedule';
import { Logger } from '@nestjs/common';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking, BookingStatus } from './schemas/booking.schema';
import { Flight, FlightStatus } from '../flights/schemas/flight.schema';
import { CreateBookingDto } from './dto/create-booking.dto';
import { FLIGHT_HOLD_DURATION_MS } from './booking.constants';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  // A conditional booking transition and inventory restoration commit together.
  // Competing workers or cancellation transactions cannot release the same hold twice.
  async expireHold(id: string, now = new Date()): Promise<boolean> {
    const session = await this.bookingModel.db.startSession();
    try {
      return (
        (await session.withTransaction(async () => {
          const booking = await this.bookingModel
            .findOneAndUpdate(
              {
                _id: id,
                status: {
                  $in: [BookingStatus.PENDING, BookingStatus.PENDING_PAYMENT],
                },
                holdExpiresAt: { $lte: now },
              },
              { $set: { status: BookingStatus.EXPIRED, expiredAt: now } },
              { new: true, session },
            )
            .exec();
          if (!booking) return false;
          const count = booking.passengers.length;
          const flight = await this.flightModel
            .findById(booking.flightId)
            .session(session)
            .exec();
          const cabin = flight?.cabins.find(
            (c) => c.cabinClass === booking.cabinClass,
          );
          if (!cabin || count < 1)
            throw new Error('Cannot restore expired hold inventory');
          const restored = await this.flightModel
            .findOneAndUpdate(
              {
                _id: booking.flightId,
                cabins: {
                  $elemMatch: {
                    cabinClass: booking.cabinClass,
                    availableSeats: { $lte: cabin.totalSeats - count },
                  },
                },
              },
              { $inc: { 'cabins.$.availableSeats': count } },
              { new: true, session },
            )
            .exec();
          if (!restored)
            throw new Error('Cannot restore expired hold inventory');
          return true;
        })) ?? false
      );
    } finally {
      await session.endSession();
    }
  }

  @Cron('*/15 * * * * *', {
    name: 'expire-seat-holds',
    waitForCompletion: true,
  })
  async expireHolds(now = new Date()): Promise<void> {
    const bookings = this.bookingModel
      .find({
        status: { $in: [BookingStatus.PENDING, BookingStatus.PENDING_PAYMENT] },
        holdExpiresAt: { $lte: now },
      })
      .select('_id')
      .cursor();
    for await (const booking of bookings) {
      try {
        await this.expireHold(booking._id.toString(), now);
      } catch {
        this.logger.error('Failed to release hold ' + booking._id.toString());
      }
    }
  }

  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<Booking>,

    @InjectModel(Flight.name)
    private readonly flightModel: Model<Flight>,
  ) {}

  async create(dto: CreateBookingDto) {
    const flightId = new Types.ObjectId(dto.flightId);
    const passengerCount = dto.passengers.length;

    const flight = await this.flightModel.findById(flightId).exec();

    if (!flight) {
      throw new NotFoundException('Flight not found');
    }

    if (flight.status !== FlightStatus.SCHEDULED) {
      throw new BadRequestException('Only scheduled flights can be booked');
    }

    if (flight.departureTimeUtc <= new Date()) {
      throw new BadRequestException(
        'Cannot book a flight that has already departed',
      );
    }

    const cabin = flight.cabins.find(
      (item) => item.cabinClass === dto.cabinClass,
    );

    if (!cabin) {
      throw new BadRequestException('Selected cabin class is not available');
    }

    if (cabin.availableSeats < passengerCount) {
      throw new BadRequestException('Not enough available seats');
    }

    const session = await this.bookingModel.db.startSession();

    try {
      let createdBooking: Booking | undefined;

      await session.withTransaction(async () => {
        const reservedFlight = await this.flightModel
          .findOneAndUpdate(
            {
              _id: flightId,
              status: FlightStatus.SCHEDULED,
              departureTimeUtc: { $gt: new Date() },
              cabins: {
                $elemMatch: {
                  cabinClass: dto.cabinClass,
                  availableSeats: { $gte: passengerCount },
                },
              },
            },
            {
              $inc: {
                'cabins.$.availableSeats': -passengerCount,
              },
            },
            {
              new: true,
              session,
            },
          )
          .exec();

        if (!reservedFlight) {
          throw new BadRequestException(
            'Seats are no longer available for this flight',
          );
        }

        const reservedCabin = reservedFlight.cabins.find(
          (item) => item.cabinClass === dto.cabinClass,
        );

        if (!reservedCabin) {
          throw new BadRequestException(
            'Selected cabin class is not available',
          );
        }

        const totalPrice = reservedCabin.price * passengerCount;

        const holdExpiresAt = new Date(Date.now() + FLIGHT_HOLD_DURATION_MS);

        const bookings = await this.bookingModel.create(
          [
            {
              flightId,
              userId: dto.userId,
              cabinClass: dto.cabinClass,
              passengers: dto.passengers,
              totalPrice,
              status: BookingStatus.PENDING_PAYMENT,
              holdExpiresAt,
            },
          ],
          { session },
        );

        createdBooking = bookings[0];
      });

      return createdBooking;
    } finally {
      await session.endSession();
    }
  }

  async confirm(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid booking ID');
    }

    const booking = await this.bookingModel.findById(id).exec();

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (
      ![BookingStatus.PENDING, BookingStatus.PENDING_PAYMENT].includes(
        booking.status,
      )
    ) {
      throw new BadRequestException('Only pending bookings can be confirmed');
    }

    if (!booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) {
      throw new BadRequestException('Booking hold has expired');
    }

    const flight = await this.flightModel.findById(booking.flightId).exec();

    if (!flight) {
      throw new NotFoundException('Flight not found');
    }

    if (
      flight.status !== FlightStatus.SCHEDULED ||
      flight.departureTimeUtc <= new Date()
    ) {
      throw new BadRequestException(
        'Cannot confirm a booking for a cancelled or departed flight',
      );
    }

    const confirmedBooking = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: booking._id,
          status: {
            $in: [BookingStatus.PENDING, BookingStatus.PENDING_PAYMENT],
          },
          holdExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            status: BookingStatus.CONFIRMED,
            confirmedAt: new Date(),
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
      .exec();

    if (!confirmedBooking) {
      throw new BadRequestException(
        'Booking could not be confirmed because its status changed',
      );
    }

    return confirmedBooking;
  }

  async cancel(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid booking ID');
    }

    const session = await this.bookingModel.db.startSession();

    try {
      let cancelledBooking: Booking | undefined;

      await session.withTransaction(async () => {
        const booking = await this.bookingModel
          .findById(id)
          .session(session)
          .exec();

        if (!booking) {
          throw new NotFoundException('Booking not found');
        }

        if (booking.status === BookingStatus.CANCELLED) {
          throw new BadRequestException('Booking is already cancelled');
        }

        if (
          ![BookingStatus.PENDING, BookingStatus.PENDING_PAYMENT].includes(
            booking.status,
          )
        ) {
          throw new BadRequestException(
            'Only unpaid holds can be cancelled until refund integration is available',
          );
        }

        const flight = await this.flightModel
          .findById(booking.flightId)
          .session(session)
          .exec();

        if (!flight) {
          throw new NotFoundException('Flight not found');
        }

        if (
          flight.status !== FlightStatus.SCHEDULED ||
          flight.departureTimeUtc <= new Date()
        ) {
          throw new BadRequestException(
            'Cannot cancel a booking after flight departure or flight cancellation',
          );
        }

        const passengerCount = booking.passengers.length;

        const cabin = flight.cabins.find(
          (item) => item.cabinClass === booking.cabinClass,
        );

        if (!cabin) {
          throw new BadRequestException(
            'Booking cabin class was not found on the flight',
          );
        }

        const maximumAvailableSeats = cabin.totalSeats - passengerCount;

        const updatedFlight = await this.flightModel
          .findOneAndUpdate(
            {
              _id: booking.flightId,
              status: FlightStatus.SCHEDULED,
              departureTimeUtc: { $gt: new Date() },
              cabins: {
                $elemMatch: {
                  cabinClass: booking.cabinClass,
                  availableSeats: {
                    $lte: maximumAvailableSeats,
                  },
                },
              },
            },
            {
              $inc: {
                'cabins.$.availableSeats': passengerCount,
              },
            },
            {
              new: true,
              session,
            },
          )
          .exec();

        if (!updatedFlight) {
          throw new BadRequestException(
            'Unable to restore seats for this booking',
          );
        }

        const result = await this.bookingModel
          .findOneAndUpdate(
            {
              _id: booking._id,
              status: {
                $in: [BookingStatus.PENDING, BookingStatus.PENDING_PAYMENT],
              },
            },
            {
              $set: {
                status: BookingStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            },
            {
              new: true,
              runValidators: true,
              session,
            },
          )
          .exec();

        if (!result) {
          throw new BadRequestException(
            'Booking could not be cancelled because its status changed',
          );
        }

        cancelledBooking = result;
      });

      return cancelledBooking;
    } finally {
      await session.endSession();
    }
  }

  // Internal only until the authenticated user/airline scope comes from Member 1.
  async generateTicket(id: string, userId: string): Promise<Buffer> {
    const booking = await this.findOne(id, userId);
    if (
      ![BookingStatus.CONFIRMED, BookingStatus.COMPLETED].includes(
        booking.status,
      )
    ) {
      throw new BadRequestException('Only confirmed bookings have e-tickets');
    }
    const flight = await this.flightModel.findById(booking.flightId).exec();
    if (!flight) throw new NotFoundException('Flight not found');
    return ticketPdf([
      'Reference: ' + (booking.reference ?? booking._id.toString()),
      'Flight: ' + flight.flightNumber,
      flight.departureAirport + ' to ' + flight.arrivalAirport,
      'Departure (UTC): ' + flight.departureTimeUtc.toISOString(),
      'Arrival (UTC): ' + flight.arrivalTimeUtc.toISOString(),
      'Cabin: ' + booking.cabinClass,
      'Passengers:',
      ...booking.passengers.map((p) => p.firstName + ' ' + p.lastName),
      'Total fare: ' + booking.totalPrice,
    ]);
  }

  async listForAirline(
    flightId: string,
    airlineId: string,
    page = 1,
    limit = 50,
  ) {
    if (
      !Types.ObjectId.isValid(flightId) ||
      !Types.ObjectId.isValid(airlineId) ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger((page - 1) * limit)
    ) {
      throw new BadRequestException('Invalid airline booking query');
    }
    const flight = await this.flightModel.findById(flightId).exec();
    if (!flight || flight.airlineId.toString() !== airlineId)
      throw new NotFoundException('Flight not found');
    return this.bookingModel
      .find({ flightId: new Types.ObjectId(flightId) })
      .sort({ createdAt: -1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();
  }

  async *exportPassengers(
    flightId: string,
    airlineId: string,
  ): AsyncGenerator<string> {
    // Validate airline scope before querying any passenger records.
    if (
      !Types.ObjectId.isValid(flightId) ||
      !Types.ObjectId.isValid(airlineId)
    ) {
      throw new BadRequestException('Invalid airline or flight ID');
    }
    const flight = await this.flightModel.findById(flightId).exec();
    if (!flight || flight.airlineId.toString() !== airlineId)
      throw new NotFoundException('Flight not found');
    yield passengerCsv([
      ['Reference', 'Cabin', 'First name', 'Last name', 'Passport'],
    ]);
    const cursor = this.bookingModel
      .find({
        flightId: new Types.ObjectId(flightId),
        status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
      })
      .sort({ _id: 1 })
      .cursor();
    for await (const booking of cursor) {
      yield passengerCsv(
        booking.passengers.map((p) => [
          booking.reference ?? booking._id.toString(),
          booking.cabinClass,
          p.firstName,
          p.lastName,
          p.passportNumber,
        ]),
      ).slice(1);
    }
  }

  async findOne(id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid booking ID');
    }

    if (!userId || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }

    const booking = await this.bookingModel
      .findOne({
        _id: id,
        userId,
      })
      .exec();

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  async findByUser(userId: string) {
    if (!userId || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }

    return this.bookingModel.find({ userId }).sort({ createdAt: -1 }).exec();
  }
}
