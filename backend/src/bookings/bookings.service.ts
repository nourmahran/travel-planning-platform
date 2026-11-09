
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Booking,
  BookingStatus,
} from './schemas/booking.schema';
import {
  Flight,
  FlightStatus,
} from '../flights/schemas/flight.schema';
import { CreateBookingDto } from './dto/create-booking.dto';

@Injectable()
export class BookingsService {
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
      throw new BadRequestException(
        'Only scheduled flights can be booked',
      );
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
      throw new BadRequestException(
        'Selected cabin class is not available',
      );
    }

    if (cabin.availableSeats < passengerCount) {
      throw new BadRequestException(
        'Not enough available seats',
      );
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

        const bookings = await this.bookingModel.create(
          [
            {
              flightId,
              userId: dto.userId,
              cabinClass: dto.cabinClass,
              passengers: dto.passengers,
              totalPrice,
              status: BookingStatus.PENDING,
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

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException(
        'Only pending bookings can be confirmed',
      );
    }

    const flight = await this.flightModel
      .findById(booking.flightId)
      .exec();

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
          status: BookingStatus.PENDING,
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
          throw new BadRequestException(
            'Booking is already cancelled',
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

        const maximumAvailableSeats =
          cabin.totalSeats - passengerCount;

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
                $in: [
                  BookingStatus.PENDING,
                  BookingStatus.CONFIRMED,
                ],
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
}
