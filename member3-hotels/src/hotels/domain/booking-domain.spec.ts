import { BadRequestException } from '@nestjs/common';
import { selectCheapestRoomCombination } from './room-selection.util';
import { assertGuestsFitRoom, splitGuests } from './occupancy.util';
import { calculateReservationTotal, calculateRoomSubtotal } from './pricing.util';

describe('occupancy', () => {
  it('splits adults and children by age', () => {
    expect(splitGuests([{ age: 30 }, { age: 8 }, { age: null }, {}])).toEqual({
      adults: 3,
      children: 1,
    });
  });

  it('enforces per-room occupancy and the hotel child policy', () => {
    const room = { maxAdults: 2, maxChildren: 1 };
    expect(() => assertGuestsFitRoom([{ age: 30 }, { age: 7 }], room, '101', true)).not.toThrow();
    expect(() => assertGuestsFitRoom([{ age: 30 }, { age: 30 }, { age: 30 }], room, '101', true)).toThrow(
      BadRequestException,
    );
    expect(() => assertGuestsFitRoom([{ age: 30 }, { age: 7 }], room, '101', false)).toThrow(
      BadRequestException,
    );
  });
});

describe('pricing', () => {
  it('multiplies nightly price by nights and sums rooms', () => {
    expect(calculateRoomSubtotal(12000, 3)).toBe(36000);
    expect(
      calculateReservationTotal([
        { pricePerNightCents: 12000, nights: 2 },
        { pricePerNightCents: 9000, nights: 2 },
      ]),
    ).toBe(42000);
  });

  it('rejects negative or fractional money', () => {
    expect(() => calculateRoomSubtotal(-1, 2)).toThrow(BadRequestException);
    expect(() => calculateRoomSubtotal(12.5, 2)).toThrow(BadRequestException);
  });
});

describe('room-selection', () => {
  const rooms = [
    { id: 'cheap-single', maxAdults: 2, maxChildren: 0, basePricePerNightCents: 8000 },
    { id: 'family', maxAdults: 4, maxChildren: 2, basePricePerNightCents: 20000 },
    { id: 'twin', maxAdults: 2, maxChildren: 1, basePricePerNightCents: 9000 },
    { id: 'suite', maxAdults: 3, maxChildren: 1, basePricePerNightCents: 15000 },
  ];

  it('picks the cheapest exactly-N combination that hosts the party', () => {
    const selection = selectCheapestRoomCombination(rooms, 2, 6);
    expect(selection?.rooms.map((room) => room.id).sort()).toEqual(['cheap-single', 'suite']);
    expect(selection?.pricePerNightCents).toBe(23000);
  });

  it('uses the cheaper pair when it already covers the party', () => {
    const selection = selectCheapestRoomCombination(rooms, 2, 5);
    expect(selection?.rooms.map((room) => room.id).sort()).toEqual(['cheap-single', 'twin']);
    expect(selection?.pricePerNightCents).toBe(17000);
  });

  it('rejects the cheapest rooms when they cannot host everyone', () => {
    const tight = [
      { id: 'cheap-a', maxAdults: 2, maxChildren: 0, basePricePerNightCents: 8000 },
      { id: 'cheap-b', maxAdults: 2, maxChildren: 0, basePricePerNightCents: 8500 },
      { id: 'family', maxAdults: 4, maxChildren: 2, basePricePerNightCents: 20000 },
    ];
    const selection = selectCheapestRoomCombination(tight, 2, 6);
    expect(selection?.rooms.map((room) => room.id).sort()).toEqual(['cheap-a', 'family']);
    expect(selection?.pricePerNightCents).toBe(28000);
  });

  it('returns null when the hotel cannot host the party', () => {
    expect(selectCheapestRoomCombination(rooms.slice(0, 2), 1, 10)).toBeNull();
    expect(selectCheapestRoomCombination(rooms, 6, 2)).toBeNull();
  });
});
