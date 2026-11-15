import { BadRequestException } from '@nestjs/common';
import { pricePassengers } from './passenger-pricing';

const departure = new Date('2030-06-15T10:00:00Z');
const passenger = (dateOfBirth: string, extraBagWeightsKg: number[] = []) => ({
  firstName: 'Test',
  lastName: 'Passenger',
  passportNumber: 'A123456',
  dateOfBirth,
  extraBagWeightsKg,
});

describe('Passenger fares and baggage', () => {
  it('charges full fare for adults and children, 10% for infants, and reserves no infant seat', () => {
    const result = pricePassengers(
      [
        passenger('2018-06-15'),
        passenger('2028-06-15'),
        passenger('2028-06-16'),
      ],
      departure,
      'utc',
      100,
    );
    expect(result.seats).toBe(2);
    expect(result.totalPrice).toBe(210);
    expect(result.passengers.map((p) => p.passengerType)).toEqual([
      'adult',
      'child',
      'infant',
    ]);
  });

  it('uses the departure airport local date at an age boundary', () => {
    const result = pricePassengers(
      [passenger('2018-06-16')],
      new Date('2030-06-15T22:00:00Z'),
      'Africa/Cairo',
      100,
    );
    expect(result.passengers[0].passengerType).toBe('adult');
  });

  it('requires an adult and at most one infant per adult', () => {
    expect(() =>
      pricePassengers([passenger('2028-06-15')], departure, 'utc', 100),
    ).toThrow(BadRequestException);
    expect(() =>
      pricePassengers(
        [
          passenger('1990-01-01'),
          passenger('2029-01-01'),
          passenger('2029-02-01'),
        ],
        departure,
        'utc',
        100,
      ),
    ).toThrow(BadRequestException);
  });

  it('adds a per-bag fee and enforces the airline weight and count limits', () => {
    const baggage = {
      freeBagsPerPassenger: 1,
      maxWeightKgPerBag: 23,
      extraBagPrice: 40,
      maxExtraBagsPerPassenger: 2,
    };
    expect(
      pricePassengers(
        [passenger('1990-01-01', [20, 23])],
        departure,
        'utc',
        100,
        baggage,
      ).totalPrice,
    ).toBe(180);
    expect(() =>
      pricePassengers(
        [passenger('1990-01-01', [24])],
        departure,
        'utc',
        100,
        baggage,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      pricePassengers(
        [passenger('1990-01-01', [1, 1, 1])],
        departure,
        'utc',
        100,
        baggage,
      ),
    ).toThrow(BadRequestException);
  });
});
