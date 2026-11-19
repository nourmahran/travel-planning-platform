import { passengerCsv, ticketPdf } from './booking-exports';
import { Cron } from '@nestjs/schedule';
import { Logger } from '@nestjs/common';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Booking, BookingStatus } from './schemas/booking.schema';
import {
  CabinDetails,
  CabinClass,
  Flight,
  FlightStatus,
} from '../flights/schemas/flight.schema';
import { CreateBookingDto } from './dto/create-booking.dto';
import type { SeatLeg } from './dto/select-seat.dto';
import { FLIGHT_HOLD_DURATION_MS } from './booking.constants';
import {
  Airline,
  BaggagePolicy,
  FlightPolicies,
} from '../airlines/schemas/airline.schema';
import { pricePassengers } from './passenger-pricing';
import { cancellationPreview } from './cancellation-preview';
import { notificationRecord } from '../common/notification-record';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  private validateSeatNumbers(
    selected: Array<number | undefined>,
    passengerTypes: string[],
    totalSeats: number,
  ): number[] {
    const numbers = selected.filter((number): number is number => number !== undefined);
    if (new Set(numbers).size !== numbers.length ||
        selected.some((number, index) => number !== undefined && passengerTypes[index] === 'infant') ||
        numbers.some((number) => !Number.isInteger(number) || number < 1 || number > totalSeats)) {
      throw new BadRequestException('Invalid or duplicate seat selection');
    }
    return numbers;
  }

  private async assertSeatsFree(
    flightId: Types.ObjectId,
    cabinClass: string,
    numbers: number[],
    session: ClientSession,
  ) {
    if (!numbers.length) return;
    const occupied = await this.bookingModel.exists({
      cabinClass,
      status: { $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
      $or: [
        { flightId, 'passengers.seatNumber': { $in: numbers } },
        { returnFlightId: flightId, 'passengers.returnSeatNumber': { $in: numbers } },
      ],
    }).session(session);
    if (occupied) throw new BadRequestException('A selected seat is no longer available');
  }

  async availableSeats(flightId: string, cabinClass: CabinClass) {
    if (!Object.values(CabinClass).includes(cabinClass)) {
      throw new BadRequestException('Invalid cabin class');
    }
    const flight = await this.flightModel.findById(flightId).lean();
    if (!flight || flight.status !== FlightStatus.SCHEDULED || flight.departureTimeUtc <= new Date()) {
      throw new NotFoundException('Flight not found');
    }
    const cabin = flight.cabins.find((item) => item.cabinClass === cabinClass);
    if (!cabin) throw new NotFoundException('Cabin not found');
    const bookings = await this.bookingModel.find({
      cabinClass,
      status: { $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
      $or: [{ flightId: flight._id }, { returnFlightId: flight._id }],
    }).select('flightId returnFlightId passengers').lean();
    const occupied = new Set<number>();
    for (const booking of bookings) {
      const outbound = booking.flightId.toString() === flightId;
      for (const passenger of booking.passengers) {
        const seat = outbound ? passenger.seatNumber : passenger.returnSeatNumber;
        if (seat) occupied.add(seat);
      }
    }
    return {
      flightId, cabinClass,
      availableSeats: cabin.availableSeats,
      numberedSeats: Array.from({ length: cabin.totalSeats }, (_, index) => index + 1)
        .filter((number) => !occupied.has(number)),
    };
  }

  private baggageForCabin(
    cabin: CabinDetails,
    fallback?: BaggagePolicy,
  ): BaggagePolicy | undefined {
    if (
      cabin.freeBagsPerPassenger !== undefined &&
      cabin.maxWeightKgPerBag !== undefined &&
      cabin.extraBagPrice !== undefined &&
      cabin.maxExtraBagsPerPassenger !== undefined
    ) {
      return {
        freeBagsPerPassenger: cabin.freeBagsPerPassenger,
        maxWeightKgPerBag: cabin.maxWeightKgPerBag,
        extraBagPrice: cabin.extraBagPrice,
        maxExtraBagsPerPassenger: cabin.maxExtraBagsPerPassenger,
      };
    }
    return fallback;
  }

  private async restoreReturnSeats(booking: Booking, session: ClientSession) {
    if (!booking.returnFlightId) return;
    const count =
      booking.returnSeatCount ?? booking.seatCount ?? booking.passengers.length;
    const flight = await this.flightModel
      .findById(booking.returnFlightId)
      .session(session)
      .exec();
    const cabin = flight?.cabins.find(
      (item) => item.cabinClass === booking.cabinClass,
    );
    if (!cabin || count < 1)
      throw new Error('Cannot restore return flight inventory');
    const restored = await this.flightModel
      .findOneAndUpdate(
        {
          _id: booking.returnFlightId,
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
    if (!restored) throw new Error('Cannot restore return flight inventory');
  }

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
          const count = booking.seatCount ?? booking.passengers.length;
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
          await this.restoreReturnSeats(booking, session);
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

    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
  ) {}

  async findForPayment(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    const booking = await this.bookingModel.findById(id).exec();
    if (!booking) return null;
    const flight = await this.flightModel.findById(booking.flightId).exec();
    if (!flight) throw new NotFoundException('Flight not found');
    return {
      id: booking._id.toString(),
      userId: booking.userId,
      providerId: flight.airlineId.toString(),
      status: booking.status,
      totalPrice: booking.totalPrice,
      holdExpiresAt: booking.holdExpiresAt,
      policiesAcceptedAt: booking.policiesAcceptedAt,
      policySnapshot: booking.policySnapshot,
      departureTimeUtc: flight.departureTimeUtc,
      reference: booking.reference,
    };
  }

  async getPaymentPolicyContext(id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid booking ID');
    const booking = await this.bookingModel.findById(id).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    const flight = await this.flightModel.findById(booking.flightId).exec();
    if (!flight) throw new NotFoundException('Flight not found');
    const airline = await this.airlineModel.findById(flight.airlineId).exec();
    if (!airline?.flightPolicies)
      throw new BadRequestException('Airline policies are not configured');
    const selected = flight.cabins.find(
      (c) => c.cabinClass === booking.cabinClass,
    );
    if (!selected) throw new BadRequestException('Booking cabin was not found');
    const baggage = this.baggageForCabin(
      selected,
      airline.flightPolicies.baggage,
    )!;
    return {
      providerId: flight.airlineId.toString(),
      providerName: airline.name,
      cancellationTiers: airline.flightPolicies.cancellationTiers.map(
        (tier) => ({
          daysBefore: tier.daysBefore,
          refundPercent: tier.refundPercent,
        }),
      ),
      baggagePolicy: {
        freeAllowanceByCabin: Object.fromEntries(
          flight.cabins.map((c) => [
            c.cabinClass,
            c.freeBagsPerPassenger ??
              airline.flightPolicies!.baggage.freeBagsPerPassenger,
          ]),
        ),
        extraBagPrice: baggage.extraBagPrice,
        maxExtraBags: baggage.maxExtraBagsPerPassenger,
        maxWeightKg: baggage.maxWeightKgPerBag,
      },
    };
  }

  async getCurrentPolicies(id: string): Promise<FlightPolicies> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid booking ID');
    const booking = await this.bookingModel.findById(id).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    const flight = await this.flightModel.findById(booking.flightId).exec();
    if (!flight) throw new NotFoundException('Flight not found');
    const airline = await this.airlineModel.findById(flight.airlineId).exec();
    if (!airline?.flightPolicies)
      throw new BadRequestException('Airline policies are not configured');
    const cabin = flight.cabins.find(
      (item) => item.cabinClass === booking.cabinClass,
    );
    if (!cabin) throw new BadRequestException('Booking cabin was not found');
    return {
      kind: 'flight',
      cancellationTiers: airline.flightPolicies.cancellationTiers,
      baggage: this.baggageForCabin(cabin, airline.flightPolicies.baggage)!,
    };
  }

  async savePolicyAcceptance(
    id: string,
    snapshot: FlightPolicies,
    acceptedAt: Date,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid booking ID');
    const saved = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: id,
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: { $gt: acceptedAt },
          policiesAcceptedAt: { $exists: false },
        },
        { $set: { policiesAcceptedAt: acceptedAt, policySnapshot: snapshot } },
        { new: true, runValidators: true },
      )
      .exec();
    if (saved) return;
    const existing = await this.bookingModel.findById(id).exec();
    if (existing?.policiesAcceptedAt && existing.policySnapshot) return;
    throw new BadRequestException('The booking hold is no longer payable');
  }

  async acceptPolicies(id: string, userId: string, now = new Date()) {
    const booking = await this.findOne(id, userId);
    if (booking.policySnapshot && booking.policiesAcceptedAt) return booking;
    if (
      booking.status !== BookingStatus.PENDING_PAYMENT ||
      !booking.holdExpiresAt ||
      booking.holdExpiresAt <= now
    ) {
      throw new BadRequestException('The booking hold is no longer payable');
    }
    const policy = await this.getCurrentPolicies(id);
    const snapshot = {
      kind: 'flight' as const,
      cancellationTiers: policy.cancellationTiers.map((tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      })),
      baggage: {
        freeBagsPerPassenger: policy.baggage.freeBagsPerPassenger,
        maxWeightKgPerBag: policy.baggage.maxWeightKgPerBag,
        extraBagPrice: policy.baggage.extraBagPrice,
        maxExtraBagsPerPassenger: policy.baggage.maxExtraBagsPerPassenger,
      },
    };
    const accepted = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: booking._id,
          userId,
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: { $gt: now },
          policiesAcceptedAt: { $exists: false },
        },
        { $set: { policiesAcceptedAt: now, policySnapshot: snapshot } },
        { new: true, runValidators: true },
      )
      .exec();
    if (accepted) return accepted;
    const latest = await this.findOne(id, userId);
    if (latest.policySnapshot && latest.policiesAcceptedAt) return latest;
    throw new BadRequestException('The booking hold is no longer payable');
  }

  async create(dto: CreateBookingDto) {
    const flightId = new Types.ObjectId(dto.flightId);

    if (
      dto.returnFlightId &&
      (!Types.ObjectId.isValid(dto.returnFlightId) ||
        dto.returnFlightId === dto.flightId)
    ) {
      throw new BadRequestException(
        'Return flight must be a different valid flight',
      );
    }

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

    // ACC-15: a deactivated airline's flights are hidden and cannot be booked.
    const airline = await this.airlineModel.findById(flight.airlineId).exec();
    if (!airline || airline.isActive === false) {
      throw new BadRequestException(
        'This airline is not accepting bookings at the moment',
      );
    }
    const quote = pricePassengers(
      dto.passengers,
      flight.departureTimeUtc,
      flight.departureTimeZone ?? 'utc',
      cabin.price,
      this.baggageForCabin(cabin, airline?.flightPolicies?.baggage),
    );
    const passengerCount = quote.seats;
    this.validateSeatNumbers(
      dto.passengers.map((passenger) => passenger.seatNumber),
      quote.passengers.map((passenger) => passenger.passengerType),
      cabin.totalSeats,
    );
    if (!dto.returnFlightId && dto.passengers.some((passenger) => passenger.returnSeatNumber !== undefined)) {
      throw new BadRequestException('A return seat requires a return flight');
    }

    const returnFlightId = dto.returnFlightId
      ? new Types.ObjectId(dto.returnFlightId)
      : undefined;
    const returnFlight = returnFlightId
      ? await this.flightModel.findById(returnFlightId).exec()
      : null;
    if (returnFlightId && !returnFlight)
      throw new NotFoundException('Return flight not found');
    if (
      returnFlight &&
      (returnFlight.status !== FlightStatus.SCHEDULED ||
        returnFlight.departureTimeUtc <= flight.arrivalTimeUtc ||
        returnFlight.departureAirport !== flight.arrivalAirport ||
        returnFlight.arrivalAirport !== flight.departureAirport)
    ) {
      throw new BadRequestException(
        'Return flight must follow the outbound arrival on the reverse route',
      );
    }
    const returnCabin = returnFlight?.cabins.find(
      (item) => item.cabinClass === dto.cabinClass,
    );
    if (returnFlight && !returnCabin)
      throw new BadRequestException('Return cabin is unavailable');
    const returnAirline = returnFlight
      ? await this.airlineModel.findById(returnFlight.airlineId).exec()
      : null;
    if (returnFlight && (!returnAirline || returnAirline.isActive === false)) {
      throw new BadRequestException(
        'The return airline is not accepting bookings at the moment',
      );
    }
    const returnQuote =
      returnFlight && returnCabin
        ? pricePassengers(
            dto.passengers,
            returnFlight.departureTimeUtc,
            returnFlight.departureTimeZone ?? 'utc',
            returnCabin.price,
            this.baggageForCabin(
              returnCabin,
              returnAirline?.flightPolicies?.baggage,
            ),
          )
        : null;
    if (
      returnCabin &&
      returnQuote &&
      returnCabin.availableSeats < returnQuote.seats
    ) {
      throw new BadRequestException('Not enough return seats');
    }
    if (returnCabin && returnQuote) {
      this.validateSeatNumbers(
        dto.passengers.map((passenger) => passenger.returnSeatNumber),
        returnQuote.passengers.map((passenger) => passenger.passengerType),
        returnCabin.totalSeats,
      );
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

        const finalQuote = pricePassengers(
          dto.passengers,
          reservedFlight.departureTimeUtc,
          reservedFlight.departureTimeZone ?? 'utc',
          reservedCabin.price,
          this.baggageForCabin(reservedCabin, airline?.flightPolicies?.baggage),
        );
        const outboundSeats = this.validateSeatNumbers(
          dto.passengers.map((passenger) => passenger.seatNumber),
          finalQuote.passengers.map((passenger) => passenger.passengerType),
          reservedCabin.totalSeats,
        );
        await this.assertSeatsFree(flightId, dto.cabinClass, outboundSeats, session);
        let totalPrice = finalQuote.totalPrice;
        let finalReturnQuote: typeof finalQuote | null = null;
        if (returnFlightId && returnQuote) {
          const reservedReturn = await this.flightModel
            .findOneAndUpdate(
              {
                _id: returnFlightId,
                status: FlightStatus.SCHEDULED,
                departureTimeUtc: { $gt: reservedFlight.arrivalTimeUtc },
                cabins: {
                  $elemMatch: {
                    cabinClass: dto.cabinClass,
                    availableSeats: { $gte: returnQuote.seats },
                  },
                },
              },
              { $inc: { 'cabins.$.availableSeats': -returnQuote.seats } },
              { new: true, session },
            )
            .exec();
          if (!reservedReturn)
            throw new BadRequestException(
              'Return seats are no longer available',
            );
          const reservedReturnCabin = reservedReturn.cabins.find(
            (item) => item.cabinClass === dto.cabinClass,
          );
          if (!reservedReturnCabin)
            throw new BadRequestException('Return cabin is unavailable');
          finalReturnQuote = pricePassengers(
            dto.passengers,
            reservedReturn.departureTimeUtc,
            reservedReturn.departureTimeZone ?? 'utc',
            reservedReturnCabin.price,
            this.baggageForCabin(
              reservedReturnCabin,
              returnAirline?.flightPolicies?.baggage,
            ),
          );
          const returnSeats = this.validateSeatNumbers(
            dto.passengers.map((passenger) => passenger.returnSeatNumber),
            finalReturnQuote.passengers.map((passenger) => passenger.passengerType),
            reservedReturnCabin.totalSeats,
          );
          await this.assertSeatsFree(returnFlightId, dto.cabinClass, returnSeats, session);
          totalPrice += finalReturnQuote.totalPrice;
        }

        const holdExpiresAt = new Date(Date.now() + FLIGHT_HOLD_DURATION_MS);

        const bookings = await this.bookingModel.create(
          [
            {
              flightId,
              returnFlightId,
              userId: dto.userId,
              cabinClass: dto.cabinClass,
              passengers: finalQuote.passengers.map((passenger, index) => ({
                ...passenger,
                seatNumber: dto.passengers[index].seatNumber,
                returnSeatNumber: dto.passengers[index].returnSeatNumber,
              })),
              totalPrice,
              seatCount: finalQuote.seats,
              returnSeatCount: finalReturnQuote?.seats,
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

  async confirm(id: string, session?: ClientSession) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid booking ID');
    }

    const bookingQuery = this.bookingModel.findById(id);
    const booking = await (
      session ? bookingQuery.session(session) : bookingQuery
    ).exec();

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

    const flightQuery = this.flightModel.findById(booking.flightId);
    const flight = await (
      session ? flightQuery.session(session) : flightQuery
    ).exec();

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

    if (booking.returnFlightId) {
      const returnQuery = this.flightModel.findById(booking.returnFlightId);
      const returnFlight = await (
        session ? returnQuery.session(session) : returnQuery
      ).exec();
      if (
        !returnFlight ||
        returnFlight.status !== FlightStatus.SCHEDULED ||
        returnFlight.departureTimeUtc <= flight.arrivalTimeUtc
      ) {
        throw new BadRequestException('Return flight is no longer available');
      }
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
          ...(session ? { session } : {}),
        },
      )
      .exec();

    if (!confirmedBooking) {
      throw new BadRequestException(
        'Booking could not be confirmed because its status changed',
      );
    }

    if (session) {
      await this.bookingModel.db.collection('notifications').insertOne(
        notificationRecord({
          recipientId: booking.userId,
          eventId: `flight:booking:confirmed:${booking._id.toString()}`,
          type: 'booking.confirmed',
          title: 'Flight booking confirmed',
          message: `Booking ${booking.reference ?? booking._id.toString()} is confirmed.`,
          link: `/bookings/${booking._id.toString()}`,
        }),
        { session },
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

        const passengerCount = booking.seatCount ?? booking.passengers.length;

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

        await this.restoreReturnSeats(booking, session);

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

  // Internal only. The caller must supply identity from Member 1's auth guard.
  async cancelConfirmedState(id: string, userId: string, now = new Date()) {
    if (!Types.ObjectId.isValid(id) || !userId?.trim())
      throw new BadRequestException('Invalid booking or user ID');
    const session = await this.bookingModel.db.startSession();
    try {
      let cancelled: Booking | undefined;
      await session.withTransaction(async () => {
        const booking = await this.bookingModel
          .findOne({ _id: id, userId, status: BookingStatus.CONFIRMED })
          .session(session)
          .exec();
        if (!booking)
          throw new NotFoundException('Confirmed booking not found');
        const flight = await this.flightModel
          .findById(booking.flightId)
          .session(session)
          .exec();
        if (!flight) throw new NotFoundException('Flight not found');
        if (
          flight.status !== FlightStatus.SCHEDULED ||
          flight.departureTimeUtc <= now
        )
          throw new BadRequestException(
            'Flight has departed or been cancelled',
          );
        const seats = booking.seatCount ?? booking.passengers.length;
        const cabin = flight.cabins.find(
          (c) => c.cabinClass === booking.cabinClass,
        );
        if (!cabin || seats < 1)
          throw new BadRequestException('Booking inventory is invalid');
        const released = await this.flightModel
          .findOneAndUpdate(
            {
              _id: booking.flightId,
              status: FlightStatus.SCHEDULED,
              departureTimeUtc: { $gt: now },
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
          throw new BadRequestException('Unable to restore booked seats');
        await this.restoreReturnSeats(booking, session);
        const result = await this.bookingModel
          .findOneAndUpdate(
            { _id: booking._id, userId, status: BookingStatus.CONFIRMED },
            {
              $set: {
                status: BookingStatus.CANCELLED,
                cancelledAt: now,
                refundDispatchPending: true,
                refundDispatchReason: 'UserCancellation',
              },
            },
            { new: true, runValidators: true, session },
          )
          .exec();
        if (!result) throw new BadRequestException('Booking status changed');
        await this.bookingModel.db.collection('notifications').insertOne(
          notificationRecord({
            recipientId: userId,
            eventId: `flight:booking:cancelled:${booking._id.toString()}`,
            type: 'booking.cancelled',
            title: 'Flight booking cancelled',
            message: `Booking ${booking.reference ?? booking._id.toString()} was cancelled.`,
            link: `/bookings/${booking._id.toString()}`,
            createdAt: now,
          }),
          { session },
        );
        cancelled = result;
      });
      return cancelled;
    } finally {
      await session.endSession();
    }
  }

  async markRefundDispatched(id: string) {
    await this.bookingModel.updateOne(
      { _id: id, refundDispatchPending: true },
      { $set: { refundDispatchPending: false } },
    );
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
    const returnFlight = booking.returnFlightId
      ? await this.flightModel.findById(booking.returnFlightId).exec()
      : null;
    if (booking.returnFlightId && !returnFlight)
      throw new NotFoundException('Return flight not found');
    return ticketPdf([
      'Reference: ' + (booking.reference ?? booking._id.toString()),
      'Flight: ' + flight.flightNumber,
      flight.departureAirport + ' to ' + flight.arrivalAirport,
      'Departure (UTC): ' + flight.departureTimeUtc.toISOString(),
      'Arrival (UTC): ' + flight.arrivalTimeUtc.toISOString(),
      ...(returnFlight
        ? [
            'Return flight: ' + returnFlight.flightNumber,
            returnFlight.departureAirport +
              ' to ' +
              returnFlight.arrivalAirport,
            'Return departure (UTC): ' +
              returnFlight.departureTimeUtc.toISOString(),
            'Return arrival (UTC): ' +
              returnFlight.arrivalTimeUtc.toISOString(),
          ]
        : []),
      'Cabin: ' + booking.cabinClass,
      'Passengers:',
      ...booking.passengers.map((p) =>
        [p.firstName, p.lastName, p.passengerType, p.dateOfBirth,
          p.seatNumber ? `Seat ${p.seatNumber}` : '',
          p.returnSeatNumber ? `Return seat ${p.returnSeatNumber}` : '']
          .filter(Boolean)
          .join(' '),
      ),
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
      .find({
        $or: [
          { flightId: new Types.ObjectId(flightId) },
          { returnFlightId: new Types.ObjectId(flightId) },
        ],
        status: { $in: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED] },
      })
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
        $or: [
          { flightId: new Types.ObjectId(flightId) },
          { returnFlightId: new Types.ObjectId(flightId) },
        ],
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

  /**
   * FLT-28: choose or change one passenger's numbered seat on an active booking.
   * The flight document is written inside the transaction so two concurrent
   * seat changes on the same flight conflict and retry instead of both winning.
   */
  async selectSeat(
    id: string,
    userId: string,
    passengerIndex: number,
    seatNumber: number,
    leg: SeatLeg = 'outbound',
  ) {
    const session = await this.bookingModel.db.startSession();
    try {
      let result: Booking | null = null;
      await session.withTransaction(async () => {
        const booking = await this.bookingModel
          .findOne({ _id: id, userId })
          .session(session)
          .exec();
        if (!booking) throw new NotFoundException('Booking not found');
        if (
          ![
            BookingStatus.PENDING,
            BookingStatus.PENDING_PAYMENT,
            BookingStatus.CONFIRMED,
          ].includes(booking.status)
        ) {
          throw new BadRequestException(
            'Seats can only be chosen on active bookings',
          );
        }
        const passenger = booking.passengers[passengerIndex];
        if (!passenger) throw new BadRequestException('Passenger not found');
        if (passenger.passengerType === 'infant') {
          throw new BadRequestException('Infants do not occupy a seat');
        }
        const flightId =
          leg === 'return' ? booking.returnFlightId : booking.flightId;
        if (!flightId) {
          throw new BadRequestException('This booking has no return flight');
        }
        const current =
          leg === 'return' ? passenger.returnSeatNumber : passenger.seatNumber;
        if (current === seatNumber) {
          result = booking;
          return;
        }
        const flight = await this.flightModel
          .findOneAndUpdate(
            {
              _id: flightId,
              status: FlightStatus.SCHEDULED,
              departureTimeUtc: { $gt: new Date() },
            },
            { $currentDate: { updatedAt: true } },
            { new: true, session },
          )
          .exec();
        if (!flight) {
          throw new BadRequestException(
            'Seats can only be chosen before a scheduled flight departs',
          );
        }
        const cabin = flight.cabins.find(
          (item) => item.cabinClass === booking.cabinClass,
        );
        if (!cabin || seatNumber > cabin.totalSeats) {
          throw new BadRequestException('Invalid seat number for this cabin');
        }
        await this.assertSeatsFree(
          flightId,
          booking.cabinClass,
          [seatNumber],
          session,
        );
        if (leg === 'return') passenger.returnSeatNumber = seatNumber;
        else passenger.seatNumber = seatNumber;
        booking.markModified('passengers');
        result = await booking.save({ session });
      });
      return result;
    } finally {
      await session.endSession();
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

  async findExpiredHoldIds(now: Date): Promise<string[]> {
    const bookings = await this.bookingModel
      .find({
        status: { $in: [BookingStatus.PENDING, BookingStatus.PENDING_PAYMENT] },
        holdExpiresAt: { $lte: now },
      })
      .select('_id')
      .exec();
    return bookings.map((booking) => booking._id.toString());
  }

  async findCompletableIds(now: Date): Promise<string[]> {
    const bookings = await this.bookingModel
      .find({ status: BookingStatus.CONFIRMED })
      .select('_id flightId returnFlightId')
      .exec();
    const result: string[] = [];
    for (const booking of bookings) {
      const lastFlight = await this.flightModel
        .findById(booking.returnFlightId ?? booking.flightId)
        .exec();
      if (lastFlight && lastFlight.arrivalTimeUtc <= now)
        result.push(booking._id.toString());
    }
    return result;
  }

  async markCompleted(id: string, now = new Date()): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const booking = await this.bookingModel.findById(id).exec();
    if (!booking || booking.status !== BookingStatus.CONFIRMED) return false;
    const lastFlight = await this.flightModel
      .findById(booking.returnFlightId ?? booking.flightId)
      .exec();
    if (!lastFlight || lastFlight.arrivalTimeUtc > now) return false;
    const updated = await this.bookingModel
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.CONFIRMED },
        { $set: { status: BookingStatus.COMPLETED, completedAt: now } },
        { new: true, runValidators: true },
      )
      .exec();
    return !!updated;
  }

  // A read-only preview. Payment/refund execution remains with Member 4.
  async previewCancellation(id: string, userId: string, now = new Date()) {
    const booking = await this.findOne(id, userId);
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed bookings can be refunded');
    }
    const flight = await this.flightModel.findById(booking.flightId).exec();
    if (!flight) throw new NotFoundException('Flight not found');
    if (!booking.policySnapshot) {
      throw new BadRequestException(
        'Booking has no accepted cancellation policy',
      );
    }
    try {
      return {
        reference: booking.reference,
        ...cancellationPreview(
          booking.totalPrice,
          flight.departureTimeUtc,
          booking.policySnapshot.cancellationTiers,
          now,
        ),
      };
    } catch {
      throw new BadRequestException('Flight has departed');
    }
  }

  // Expose through an owner-only route once Member 1 provides authenticated identity.
  async historyForUser(userId: string, now = new Date()) {
    const bookings = (await this.findByUser(userId)).filter((booking) =>
      [
        BookingStatus.CONFIRMED,
        BookingStatus.COMPLETED,
        BookingStatus.CANCELLED,
      ].includes(booking.status),
    );
    const flightIds = [
      ...new Set(
        bookings.flatMap((booking) => [
          booking.flightId.toString(),
          ...(booking.returnFlightId
            ? [booking.returnFlightId.toString()]
            : []),
        ]),
      ),
    ];
    const flights = flightIds.length
      ? await this.flightModel.find({ _id: { $in: flightIds } }).exec()
      : [];
    const byId = new Map(
      flights.map((flight) => [flight._id.toString(), flight]),
    );
    const result = {
      upcoming: [] as typeof bookings,
      past: [] as typeof bookings,
      cancelled: [] as typeof bookings,
    };
    for (const booking of bookings) {
      if (booking.status === BookingStatus.CANCELLED) {
        result.cancelled.push(booking);
        continue;
      }
      const finalFlight = byId.get(
        (booking.returnFlightId ?? booking.flightId).toString(),
      );
      if (finalFlight && finalFlight.departureTimeUtc > now)
        result.upcoming.push(booking);
      else result.past.push(booking);
    }
    return result;
  }
}
