import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingStatus } from './schemas/booking.schema';
import { Flight, FlightStatus } from '../flights/schemas/flight.schema';
import { pricePassengers } from './passenger-pricing';
import { getPlatformCurrency } from '../common/booking';
import { Airline } from '../airlines/schemas/airline.schema';

export type ChangeLeg = 'outbound' | 'return';

@Injectable()
export class FlightChangeService {
  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<Booking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    private readonly config: ConfigService,
  ) {}

  async preview(bookingId: string, ownerId: string, candidateId: string, leg: ChangeLeg) {
    if (leg !== 'outbound' && leg !== 'return') throw new BadRequestException('leg must be outbound or return');
    const booking = await this.bookings.findById(bookingId).lean();
    if (!booking || booking.userId !== ownerId) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.CONFIRMED) throw new BadRequestException('Only confirmed bookings can be changed');
    const currentId = leg === 'outbound' ? booking.flightId : booking.returnFlightId;
    if (!currentId) throw new BadRequestException('This booking has no return flight');
    const [current, candidate] = await Promise.all([
      this.flights.findById(currentId).lean(),
      this.flights.findById(candidateId).lean(),
    ]);
    if (!current || !candidate) throw new NotFoundException('Flight not found');
    if (current.departureTimeUtc <= new Date()) throw new BadRequestException('Cannot change a departed flight');
    if (candidate._id.equals(current._id) || candidate.status !== FlightStatus.SCHEDULED ||
        candidate.departureTimeUtc <= new Date() ||
        candidate.departureAirport !== current.departureAirport ||
        candidate.arrivalAirport !== current.arrivalAirport) {
      throw new BadRequestException('New flight must be scheduled, future, and on the same route');
    }
    if (booking.returnFlightId) {
      const pairedId = leg === 'outbound' ? booking.returnFlightId : booking.flightId;
      const paired = await this.flights.findById(pairedId).lean();
      if (!paired || (leg === 'outbound'
        ? candidate.arrivalTimeUtc >= paired.departureTimeUtc
        : candidate.departureTimeUtc <= paired.arrivalTimeUtc)) {
        throw new BadRequestException('New flight must preserve the round-trip order');
      }
    }
    const cabin = candidate.cabins.find((item) => item.cabinClass === booking.cabinClass);
    if (!cabin) throw new BadRequestException('Booked cabin is unavailable on the new flight');
    const airline = booking.passengers.some((passenger) => passenger.extraBagWeightsKg?.length)
      ? await this.airlines.findById(candidate.airlineId).lean() : null;
    const baggage = cabin.freeBagsPerPassenger !== undefined && cabin.maxWeightKgPerBag !== undefined &&
      cabin.extraBagPrice !== undefined && cabin.maxExtraBagsPerPassenger !== undefined
      ? { freeBagsPerPassenger: cabin.freeBagsPerPassenger, maxWeightKgPerBag: cabin.maxWeightKgPerBag,
          extraBagPrice: cabin.extraBagPrice, maxExtraBagsPerPassenger: cabin.maxExtraBagsPerPassenger }
      : airline?.flightPolicies?.baggage;
    const quoted = pricePassengers(
      booking.passengers.map((passenger) => ({
        firstName: passenger.firstName, lastName: passenger.lastName,
        passportNumber: passenger.passportNumber, dateOfBirth: passenger.dateOfBirth,
        extraBagWeightsKg: passenger.extraBagWeightsKg,
      })),
      candidate.departureTimeUtc,
      candidate.departureTimeZone,
      cabin.price,
      baggage,
    );
    if (cabin.availableSeats < quoted.seats) throw new BadRequestException('Not enough seats on the new flight');
    const oldOutbound = booking.passengers.reduce((sum, passenger) => sum + passenger.fare + passenger.baggageFee, 0);
    const oldLegAmount = leg === 'outbound' ? oldOutbound : booking.totalPrice - oldOutbound;
    const difference = Math.round((quoted.totalPrice - oldLegAmount) * 100) / 100;
    return {
      bookingId, leg, currentFlightId: String(current._id), newFlightId: String(candidate._id),
      cabinClass: booking.cabinClass, oldLegAmount: Math.round(oldLegAmount * 100) / 100,
      newLegAmount: quoted.totalPrice, amountDue: Math.max(difference, 0),
      refundAmount: Math.max(-difference, 0), currency: getPlatformCurrency(this.config),
      seatsRequired: quoted.seats,
    };
  }
}
