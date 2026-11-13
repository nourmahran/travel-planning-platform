import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { BookingPassengerDto } from './dto/create-booking.dto';
import type { BaggagePolicy } from '../airlines/schemas/airline.schema';

function ageOnDeparture(dob: string, departure: Date, zone: string): number {
  const birth = DateTime.fromISO(dob, { zone: 'utc' });
  if (!birth.isValid || birth.toISODate() !== dob) {
    throw new BadRequestException('Invalid passenger date of birth');
  }
  const day = DateTime.fromJSDate(departure, { zone });
  const age =
    day.year -
    birth.year -
    (day.month < birth.month ||
    (day.month === birth.month && day.day < birth.day)
      ? 1
      : 0);
  if (age < 0)
    throw new BadRequestException('Passenger date of birth is after departure');
  return age;
}

export function pricePassengers(
  passengers: BookingPassengerDto[],
  departure: Date,
  zone: string,
  cabinFare: number,
  baggage?: BaggagePolicy,
) {
  const priced = passengers.map((passenger) => {
    const age = ageOnDeparture(passenger.dateOfBirth, departure, zone);
    const passengerType = age >= 12 ? 'adult' : age >= 2 ? 'child' : 'infant';
    const weights = passenger.extraBagWeightsKg ?? [];
    if (weights.length && !baggage)
      throw new BadRequestException(
        'Extra baggage is unavailable for this flight',
      );
    if (
      baggage &&
      (weights.length > baggage.maxExtraBagsPerPassenger ||
        weights.some(
          (weight) =>
            !Number.isFinite(weight) ||
            weight <= 0 ||
            weight > baggage.maxWeightKgPerBag,
        ))
    ) {
      throw new BadRequestException('Extra baggage exceeds the airline limit');
    }
    const fare =
      passengerType === 'infant' ? Math.round(cabinFare * 10) / 100 : cabinFare;
    const baggageFee = weights.length * (baggage?.extraBagPrice ?? 0);
    return {
      firstName: passenger.firstName,
      lastName: passenger.lastName,
      passportNumber: passenger.passportNumber,
      dateOfBirth: passenger.dateOfBirth,
      passengerType,
      extraBagWeightsKg: weights,
      fare,
      baggageFee,
    };
  });
  const adults = priced.filter((p) => p.passengerType === 'adult').length;
  const infants = priced.filter((p) => p.passengerType === 'infant').length;
  if (adults < 1 || infants > adults) {
    throw new BadRequestException(
      'A booking needs an adult and no more than one infant per adult',
    );
  }
  return {
    passengers: priced,
    seats: priced.length - infants,
    totalPrice:
      Math.round(
        priced.reduce((sum, p) => sum + p.fare + p.baggageFee, 0) * 100,
      ) / 100,
  };
}
