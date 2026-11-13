import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BookingStatus, Booking } from '../bookings/schemas/booking.schema';
import { BookingType } from '../common/booking';
import { RefundsService } from '../payments/refunds.service';
import { RefundReason } from '../payments/schemas/refund.schema';
import { Flight, FlightStatus } from './schemas/flight.schema';
import { notificationRecord } from '../common/notification-record';

@Injectable()
export class ProviderFlightCancellationService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    private readonly refunds: RefundsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private async releaseOtherLeg(
    booking: Booking,
    cancelledFlightId: string,
    legId: Types.ObjectId | undefined,
    seats: number,
    session: ClientSession,
    now: Date,
  ) {
    if (!legId || legId.toString() === cancelledFlightId) return;
    const other = await this.flights.findById(legId).session(session).exec();
    if (!other) throw new NotFoundException('Other flight leg not found');
    if (
      other.status !== FlightStatus.SCHEDULED ||
      other.departureTimeUtc <= now
    )
      return;
    const cabin = other.cabins.find((c) => c.cabinClass === booking.cabinClass);
    if (!cabin || seats < 1)
      throw new BadRequestException('Other flight inventory is invalid');
    const released = await this.flights
      .findOneAndUpdate(
        {
          _id: legId,
          status: FlightStatus.SCHEDULED,
          cabins: {
            $elemMatch: {
              cabinClass: booking.cabinClass,
              availableSeats: { $lte: cabin.totalSeats - seats },
            },
          },
        },
        { $inc: { 'cabins.$.availableSeats': seats } },
        { new: true, session },
      )
      .exec();
    if (!released)
      throw new BadRequestException('Unable to release other flight leg');
  }

  private async issueProviderRefunds(flightId: string) {
    const bookings = await this.bookings
      .find({
        status: BookingStatus.CANCELLED,
        providerCancelledFlightId: new Types.ObjectId(flightId),
        refundDispatchPending: true,
      })
      .exec();
    for (const booking of bookings) {
      await this.refunds.issueRefund(
        BookingType.Flight,
        booking._id.toString(),
        RefundReason.ProviderCancellation,
      );
      await this.bookings.updateOne(
        { _id: booking._id, refundDispatchPending: true },
        { $set: { refundDispatchPending: false } },
      );
    }
    return bookings.length;
  }

  // Internal only until Member 1 supplies authenticated airline ownership.
  async cancelForAirline(
    flightId: string,
    airlineId: string,
    now = new Date(),
  ) {
    if (!Types.ObjectId.isValid(flightId) || !Types.ObjectId.isValid(airlineId))
      throw new BadRequestException('Invalid flight or airline ID');
    const current = await this.flights.findById(flightId).exec();
    if (!current || current.airlineId.toString() !== airlineId)
      throw new NotFoundException('Flight not found');
    if (current.status === FlightStatus.CANCELLED) {
      const refundCount = await this.issueProviderRefunds(flightId);
      return { flight: current, refundedBookings: refundCount };
    }
    if (
      current.status !== FlightStatus.SCHEDULED ||
      current.departureTimeUtc <= now
    )
      throw new BadRequestException(
        'Only future scheduled flights can be cancelled',
      );

    const affectedQuery = {
      $or: [{ flightId: current._id }, { returnFlightId: current._id }],
      status: {
        $in: [
          BookingStatus.PENDING,
          BookingStatus.PENDING_PAYMENT,
          BookingStatus.CONFIRMED,
        ],
      },
    };
    const confirmed = await this.bookings
      .find({
        ...affectedQuery,
        status: BookingStatus.CONFIRMED,
      })
      .exec();
    for (const booking of confirmed) {
      await this.refunds.assertSuccessfulPayment(
        BookingType.Flight,
        booking._id.toString(),
      );
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const flight = await this.flights
          .findOne({
            _id: current._id,
            airlineId: current.airlineId,
            status: FlightStatus.SCHEDULED,
            departureTimeUtc: { $gt: now },
          })
          .session(session)
          .exec();
        if (!flight) throw new BadRequestException('Flight status changed');
        const affected = await this.bookings
          .find(affectedQuery)
          .session(session)
          .exec();
        for (const booking of affected) {
          await this.releaseOtherLeg(
            booking,
            flightId,
            booking.flightId,
            booking.seatCount ?? booking.passengers.length,
            session,
            now,
          );
          await this.releaseOtherLeg(
            booking,
            flightId,
            booking.returnFlightId,
            booking.returnSeatCount ??
              booking.seatCount ??
              booking.passengers.length,
            session,
            now,
          );
          const updated = await this.bookings
            .findOneAndUpdate(
              { _id: booking._id, status: booking.status },
              {
                $set: {
                  status: BookingStatus.CANCELLED,
                  cancelledAt: now,
                  ...(booking.status === BookingStatus.CONFIRMED
                    ? {
                        providerCancelledFlightId: flight._id,
                        refundDispatchPending: true,
                        refundDispatchReason: 'ProviderCancellation',
                      }
                    : {}),
                },
              },
              { new: true, session },
            )
            .exec();
          if (!updated) throw new BadRequestException('Booking status changed');
        }
        const cancelled = await this.flights
          .findOneAndUpdate(
            { _id: flight._id, status: FlightStatus.SCHEDULED },
            {
              $set: {
                status: FlightStatus.CANCELLED,
                cabins: flight.cabins.map((c) => ({
                  cabinClass: c.cabinClass,
                  price: c.price,
                  totalSeats: c.totalSeats,
                  baggageAllowanceKg: c.baggageAllowanceKg,
                  extraBaggagePricePerKg: c.extraBaggagePricePerKg,
                  freeBagsPerPassenger: c.freeBagsPerPassenger,
                  maxWeightKgPerBag: c.maxWeightKgPerBag,
                  extraBagPrice: c.extraBagPrice,
                  maxExtraBagsPerPassenger: c.maxExtraBagsPerPassenger,
                  availableSeats: c.totalSeats,
                })),
              },
            },
            { new: true, session },
          )
          .exec();
        if (!cancelled) throw new BadRequestException('Flight status changed');
        if (affected.length) {
          await this.connection.collection('notifications').insertMany(
            affected.map((booking) =>
              notificationRecord({
                recipientId: booking.userId,
                eventId: `flight:provider:cancelled:${flight._id.toString()}:${booking._id.toString()}`,
                type: 'booking.cancelled',
                title: 'Flight cancelled',
                message: `Flight ${flight.flightNumber} was cancelled by the airline.`,
                link: `/bookings/${booking._id.toString()}`,
                createdAt: now,
              }),
            ),
            { session },
          );
        }
      });
    } finally {
      await session.endSession();
    }
    const refundedBookings = await this.issueProviderRefunds(flightId);
    const flight = await this.flights.findById(flightId).exec();
    return { flight, refundedBookings };
  }
}
