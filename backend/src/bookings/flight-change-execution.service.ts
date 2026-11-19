import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Connection, Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Booking, BookingStatus } from './schemas/booking.schema';
import { CabinClass, Flight, FlightStatus } from '../flights/schemas/flight.schema';
import { FlightChange, FlightChangeDocument } from './schemas/flight-change.schema';
import { FlightChangeService, type ChangeLeg } from './flight-change.service';
import { pricePassengers } from './passenger-pricing';
import { Payment, PaymentStatus } from '../payments/schemas/payment.schema';
import { Refund, RefundReason, RefundStatus } from '../payments/schemas/refund.schema';
import { StripeService } from '../payments/stripe/stripe.service';
import { BookingType, getPlatformCurrency } from '../common/booking';
import { notificationRecord } from '../common/notification-record';
import { Airline } from '../airlines/schemas/airline.schema';

@Injectable()
export class FlightChangeExecutionService {
  private readonly logger = new Logger(FlightChangeExecutionService.name);
  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(FlightChange.name) private readonly changes: Model<FlightChangeDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectConnection() private readonly connection: Connection,
    private readonly quotes: FlightChangeService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  async request(bookingId: string, userId: string, newFlightId: string, leg: ChangeLeg) {
    const quote = await this.quotes.preview(bookingId, userId, newFlightId, leg);
    const originalPayment = await this.payments.findOne({
      bookingType: BookingType.Flight, bookingId: new Types.ObjectId(bookingId), status: PaymentStatus.Succeeded,
    });
    if (!originalPayment) throw new ConflictException('Original booking has no verified payment');
    if (await this.changes.exists({ bookingId: new Types.ObjectId(bookingId), status: 'Confirmed' })) {
      throw new ConflictException('This booking has already been changed');
    }
    const [booking, candidate] = await Promise.all([
      this.bookings.findById(bookingId).lean(), this.flights.findById(newFlightId).lean(),
    ]);
    if (!booking || !candidate) throw new NotFoundException('Booking or flight not found');
    const cabin = candidate.cabins.find((item) => item.cabinClass === booking.cabinClass);
    if (!cabin) throw new BadRequestException('Cabin unavailable');
    const airline = booking.passengers.some((passenger) => passenger.extraBagWeightsKg?.length)
      ? await this.airlines.findById(candidate.airlineId).lean() : null;
    const priced = pricePassengers(
      booking.passengers.map((passenger) => ({
        firstName: passenger.firstName, lastName: passenger.lastName,
        passportNumber: passenger.passportNumber, dateOfBirth: passenger.dateOfBirth,
        extraBagWeightsKg: passenger.extraBagWeightsKg,
      })), candidate.departureTimeUtc, candidate.departureTimeZone, cabin.price,
      cabin.freeBagsPerPassenger !== undefined && cabin.maxWeightKgPerBag !== undefined &&
      cabin.extraBagPrice !== undefined && cabin.maxExtraBagsPerPassenger !== undefined
        ? { freeBagsPerPassenger: cabin.freeBagsPerPassenger, maxWeightKgPerBag: cabin.maxWeightKgPerBag,
            extraBagPrice: cabin.extraBagPrice, maxExtraBagsPerPassenger: cabin.maxExtraBagsPerPassenger }
        : airline?.flightPolicies?.baggage,
    );
    if (priced.totalPrice !== quote.newLegAmount) throw new ConflictException('Fare changed; request a new preview');
    const oldSeats = leg === 'outbound' ? (booking.seatCount ?? booking.passengers.length) :
      (booking.returnSeatCount ?? booking.seatCount ?? booking.passengers.length);
    const session = await this.connection.startSession();
    let change: FlightChangeDocument | undefined;
    try {
      await session.withTransaction(async () => {
        const current = await this.bookings.findOne({ _id: booking._id, status: BookingStatus.CONFIRMED,
          [leg === 'outbound' ? 'flightId' : 'returnFlightId']: new Types.ObjectId(quote.currentFlightId) }).session(session);
        if (!current) throw new ConflictException('Booking changed; request a new preview');
        const active = await this.changes.exists({ bookingId: booking._id, status: 'PendingPayment' }).session(session);
        if (active) throw new ConflictException('A flight change is already pending');
        const reserved = await this.flights.findOneAndUpdate({
          _id: new Types.ObjectId(newFlightId), status: FlightStatus.SCHEDULED,
          departureTimeUtc: { $gt: new Date() },
          cabins: { $elemMatch: { cabinClass: booking.cabinClass, price: cabin.price,
            availableSeats: { $gte: priced.seats } } },
        }, { $inc: { 'cabins.$.availableSeats': -priced.seats } }, { session, returnDocument: 'after' });
        if (!reserved) throw new ConflictException('New flight fare or availability changed');
        const [created] = await this.changes.create([{
          bookingId: booking._id, userId: new Types.ObjectId(userId), leg,
          oldFlightId: new Types.ObjectId(quote.currentFlightId), newFlightId: new Types.ObjectId(newFlightId),
          cabinClass: booking.cabinClass, oldLegAmount: quote.oldLegAmount,
          newLegAmount: quote.newLegAmount, amountDue: quote.amountDue,
          refundAmount: quote.refundAmount, seatsRequired: priced.seats, oldSeats,
          newPassengers: priced.passengers, status: 'PendingPayment',
          holdExpiresAt: new Date(Date.now() + 10 * 60_000),
        }], { session });
        change = created;
      });
    } finally { await session.endSession(); }
    if (!change) throw new ConflictException('Could not create flight change');
    if (change.amountDue === 0) {
      let completed = false;
      try { completed = await this.confirm(String(change._id)); }
      catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
      if (!completed) {
        await this.expire(String(change._id), true);
        throw new ConflictException('Flight change hold expired or flight status changed');
      }
      if (change.refundAmount > 0) {
        try { await this.issueFareRefund(change); }
        catch (error) { this.logger.warn(`Fare refund queued for retry: ${(error as Error).message}`); }
      }
    }
    return {
      changeId: String(change._id), status: change.amountDue > 0 ? 'PendingPayment' : 'Confirmed',
      amountDue: change.amountDue, refundAmount: change.refundAmount,
      currency: getPlatformCurrency(this.config), holdExpiresAt: change.holdExpiresAt,
      payment: change.amountDue > 0 ? { bookingType: BookingType.FlightChange, bookingId: String(change._id) } : null,
    };
  }

  async find(id: string) { return this.changes.findById(id).lean(); }

  async confirm(id: string): Promise<boolean> {
    const session = await this.connection.startSession();
    try {
      let changed = false;
      await session.withTransaction(async () => {
        const change = await this.changes.findOne({ _id: id, status: 'PendingPayment', holdExpiresAt: { $gt: new Date() } }).session(session);
        if (!change) return;
        const booking = await this.bookings.findOne({ _id: change.bookingId, status: BookingStatus.CONFIRMED,
          [change.leg === 'outbound' ? 'flightId' : 'returnFlightId']: change.oldFlightId }).session(session);
        if (!booking) return;
        const [oldFlight, newFlight] = await Promise.all([
          this.flights.findById(change.oldFlightId).session(session),
          this.flights.findById(change.newFlightId).session(session),
        ]);
        if (!oldFlight || !newFlight || oldFlight.status !== FlightStatus.SCHEDULED ||
          oldFlight.departureTimeUtc <= new Date() || newFlight.status !== FlightStatus.SCHEDULED ||
          newFlight.departureTimeUtc <= new Date()) return;
        if (booking.returnFlightId) {
          const pairedId = change.leg === 'outbound' ? booking.returnFlightId : booking.flightId;
          const paired = await this.flights.findById(pairedId).session(session);
          if (!paired || (change.leg === 'outbound'
            ? newFlight.arrivalTimeUtc >= paired.departureTimeUtc
            : newFlight.departureTimeUtc <= paired.arrivalTimeUtc)) return;
        }
        const oldCabin = oldFlight.cabins.find((cabin) => cabin.cabinClass === change.cabinClass);
        if (!oldCabin || oldCabin.availableSeats > oldCabin.totalSeats - change.oldSeats) {
          throw new ConflictException('Original flight inventory is inconsistent');
        }
        const newTotal = Math.round((booking.totalPrice + change.newLegAmount - change.oldLegAmount) * 100) / 100;
        const update: Record<string, unknown> = { totalPrice: newTotal };
        if (change.leg === 'outbound') {
          update.flightId = change.newFlightId;
          update.seatCount = change.seatsRequired;
          update.passengers = booking.passengers.map((passenger, index) => ({
            firstName: passenger.firstName, lastName: passenger.lastName,
            passportNumber: passenger.passportNumber, dateOfBirth: passenger.dateOfBirth,
            extraBagWeightsKg: passenger.extraBagWeightsKg,
            returnSeatNumber: passenger.returnSeatNumber,
            fare: change.newPassengers[index].fare,
            baggageFee: change.newPassengers[index].baggageFee,
            passengerType: change.newPassengers[index].passengerType,
          }));
        } else {
          update.returnFlightId = change.newFlightId;
          update.returnSeatCount = change.seatsRequired;
          update.passengers = booking.passengers.map((passenger) => ({
            firstName: passenger.firstName, lastName: passenger.lastName,
            passportNumber: passenger.passportNumber, dateOfBirth: passenger.dateOfBirth,
            extraBagWeightsKg: passenger.extraBagWeightsKg,
            seatNumber: passenger.seatNumber, fare: passenger.fare,
            baggageFee: passenger.baggageFee, passengerType: passenger.passengerType,
          }));
        }
        const updatedBooking = await this.bookings.updateOne({ _id: booking._id, status: BookingStatus.CONFIRMED }, { $set: update }, { session });
        if (updatedBooking.modifiedCount !== 1) throw new ConflictException('Booking changed during flight change');
        const released = await this.flights.updateOne({ _id: change.oldFlightId,
          cabins: { $elemMatch: { cabinClass: change.cabinClass as CabinClass,
            availableSeats: { $lte: oldCabin.totalSeats - change.oldSeats } } } },
          { $inc: { 'cabins.$.availableSeats': change.oldSeats } }, { session });
        if (released.modifiedCount !== 1) throw new ConflictException('Could not release original flight seats');
        const confirmed = await this.changes.updateOne({ _id: change._id, status: 'PendingPayment' },
          { $set: { status: 'Confirmed', confirmedAt: new Date(), refundDispatchPending: change.refundAmount > 0 } }, { session });
        if (confirmed.modifiedCount !== 1) throw new ConflictException('Flight change status changed');
        await this.connection.collection('notifications').insertOne(notificationRecord({
          recipientId: String(change.userId), type: 'booking.updated', title: 'Flight booking changed',
          message: `Your flight booking ${String(booking.reference ?? booking._id)} was changed.`,
          eventId: `flight-change:${String(change._id)}:${randomUUID()}`,
        }), { session });
        changed = true;
      });
      return changed;
    } finally { await session.endSession(); }
  }

  async expire(id: string, force = false): Promise<boolean> {
    const session = await this.connection.startSession();
    try {
      let expired = false;
      await session.withTransaction(async () => {
        const change = await this.changes.findOneAndUpdate({ _id: id, status: 'PendingPayment',
          ...(force ? {} : { holdExpiresAt: { $lte: new Date() } }) },
          { $set: { status: 'Expired', expiredAt: new Date() } }, { session, returnDocument: 'after' });
        if (!change) return;
        const released = await this.flights.updateOne({ _id: change.newFlightId, 'cabins.cabinClass': change.cabinClass as CabinClass },
          { $inc: { 'cabins.$.availableSeats': change.seatsRequired } }, { session });
        if (released.modifiedCount !== 1) throw new ConflictException('Could not release replacement seats');
        expired = true;
      });
      return expired;
    } finally { await session.endSession(); }
  }

  @Cron('*/15 * * * * *')
  async expirePending(): Promise<void> {
    const pending = await this.changes.find({ status: 'PendingPayment' }).select('_id bookingId holdExpiresAt').lean();
    for (const item of pending) {
      const booking = await this.bookings.findById(item.bookingId).select('status').lean();
      const force = !booking || booking.status !== BookingStatus.CONFIRMED;
      if (force || item.holdExpiresAt <= new Date()) await this.expire(String(item._id), force);
    }
  }

  @Cron('0 * * * * *')
  async retryFareRefunds(): Promise<void> {
    const changes = await this.changes.find({ status: 'Confirmed', refundDispatchPending: true });
    for (const change of changes) {
      try { await this.issueFareRefund(change); }
      catch (error) { this.logger.warn(`Fare refund retry failed for ${String(change._id)}: ${(error as Error).message}`); }
    }
  }

  private async issueFareRefund(change: FlightChangeDocument): Promise<void> {
    const payment = await this.payments.findOne({ bookingType: BookingType.Flight, bookingId: change.bookingId, status: PaymentStatus.Succeeded });
    if (!payment) throw new ConflictException('Original payment missing');
    const amount = Math.round(change.refundAmount * 100);
    const filter = { bookingType: BookingType.FlightChange, bookingId: change._id };
    const refund = await this.refunds.findOneAndUpdate(filter, { $setOnInsert: {
      ...filter, paymentId: payment._id, userId: change.userId, amount,
      percent: 100, currency: payment.currency, reason: RefundReason.FlightChange,
      status: RefundStatus.Pending,
    } }, { upsert: true, returnDocument: 'after' });
    if (refund.status === RefundStatus.Refunded) {
      await this.changes.updateOne({ _id: change._id }, { $set: { refundDispatchPending: false } });
      return;
    }
    const result = await this.stripe.createRefund({
      paymentIntentId: payment.stripePaymentIntentId, amountMinor: amount,
      idempotencyKey: `flight-change-refund:${String(change._id)}`,
      metadata: { refundId: String(refund._id), bookingType: BookingType.FlightChange,
        bookingId: String(change._id), reason: RefundReason.FlightChange },
    });
    await this.refunds.updateOne({ _id: refund._id }, { $set: {
      stripeRefundId: result.id,
      status: result.status === 'succeeded' ? RefundStatus.Refunded : RefundStatus.Pending,
    } });
    await this.changes.updateOne({ _id: change._id }, { $set: { refundDispatchPending: false } });
  }
}
