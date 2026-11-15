import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { DaysService } from './days.service';
import { ItinerariesService } from './itineraries.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';

const OWNER = 'a'.repeat(24);
const ITINERARY_ID = 'c'.repeat(24);
const DAY_ID = [1, 2, 3].map((n) => String(n).repeat(24));

type FakeDay = {
  _id: string;
  dayNumber: number;
  date: string;
  cityId: string;
  notes?: string;
  activities: unknown[];
  budgets: unknown[];
};

type FakeItinerary = {
  _id: string;
  startDate: string;
  countries: string[];
  days: FakeDay[];
  save: jest.Mock;
};

const makeDay = (index: number, cityId = 'cairo'): FakeDay => ({
  _id: DAY_ID[index],
  dayNumber: index + 1,
  date: 'stale',
  cityId,
  activities: [],
  budgets: [],
});

const makeItinerary = (days: FakeDay[] = []): FakeItinerary => ({
  _id: ITINERARY_ID,
  startDate: '2026-11-20',
  countries: ['EG'],
  days,
  save: jest.fn().mockResolvedValue(undefined),
});

describe('DaysService', () => {
  let service: DaysService;
  let itinerary: FakeItinerary;
  let itineraries: { findOne: jest.Mock };
  let referenceData: { city: jest.Mock };

  beforeEach(async () => {
    itineraries = { findOne: jest.fn() };
    referenceData = {
      city: jest.fn().mockResolvedValue({
        city_id: 'cairo',
        name: 'Cairo',
        country_code: 'EG',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DaysService,
        { provide: ItinerariesService, useValue: itineraries },
        { provide: ReferenceDataService, useValue: referenceData },
      ],
    }).compile();

    service = module.get(DaysService);
  });

  const load = (days: FakeDay[] = []) => {
    itinerary = makeItinerary(days);
    // Mongoose assigns an _id to every subdocument; the fake does it on save.
    itinerary.save.mockImplementation(async () => {
      itinerary.days.forEach((day, index) => {
        if (!day._id) {
          day._id = `${index + 4}`.repeat(24).slice(0, 24);
        }
      });
    });
    itineraries.findOne.mockResolvedValue(itinerary);

    return itinerary;
  };

  describe('add', () => {
    it('appends a numbered day and dates it from the start date', async () => {
      load([makeDay(0)]);

      const result = await service.add(OWNER, ITINERARY_ID, { cityId: 'cairo' });

      expect(result).toMatchObject({ dayCount: 2, day: { dayNumber: 2 } });
      expect(itinerary.days).toHaveLength(2);
      expect(itinerary.days[1].date).toBe('2026-11-21');
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('rejects a 61st day', async () => {
      load(
        Array.from({ length: 60 }, (_value, index) => ({
          ...makeDay(0),
          _id: String(index).padStart(24, '0'),
        })),
      );

      await expect(
        service.add(OWNER, ITINERARY_ID, { cityId: 'cairo' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown city', async () => {
      load();
      referenceData.city.mockResolvedValue(null);

      await expect(
        service.add(OWNER, ITINERARY_ID, { cityId: 'atlantis' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a city outside the itinerary countries', async () => {
      load();
      referenceData.city.mockResolvedValue({
        city_id: 'paris',
        name: 'Paris',
        country_code: 'FR',
      });

      await expect(
        service.add(OWNER, ITINERARY_ID, { cityId: 'paris' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('renumbers the remaining days and recalculates their dates', async () => {
      load([makeDay(0), makeDay(1, 'luxor'), makeDay(2, 'aswan')]);

      await service.remove(OWNER, ITINERARY_ID, DAY_ID[1]);

      expect(itinerary.days).toHaveLength(2);
      expect(itinerary.days.map((day) => day.dayNumber)).toEqual([1, 2]);
      expect(itinerary.days.map((day) => day.date)).toEqual([
        '2026-11-20',
        '2026-11-21',
      ]);
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('throws NotFound for a day of another itinerary', async () => {
      load([makeDay(0)]);

      await expect(
        service.remove(OWNER, ITINERARY_ID, 'f'.repeat(24)),
      ).rejects.toThrow('Day not found');
    });
  });

  describe('reorder', () => {
    it('rebuilds the order and moves the dates with it', async () => {
      load([makeDay(0), makeDay(1, 'luxor'), makeDay(2, 'aswan')]);

      await service.reorder(OWNER, ITINERARY_ID, [
        DAY_ID[2],
        DAY_ID[0],
        DAY_ID[1],
      ]);

      expect(itinerary.days.map((day) => day.cityId)).toEqual([
        'aswan',
        'cairo',
        'luxor',
      ]);
      expect(itinerary.days.map((day) => day.date)).toEqual([
        '2026-11-20',
        '2026-11-21',
        '2026-11-22',
      ]);
    });

    it('rejects a partial list', async () => {
      load([makeDay(0), makeDay(1)]);

      await expect(
        service.reorder(OWNER, ITINERARY_ID, [DAY_ID[0]]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects duplicates', async () => {
      load([makeDay(0), makeDay(1)]);

      await expect(
        service.reorder(OWNER, ITINERARY_ID, [DAY_ID[0], DAY_ID[0]]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an id that belongs to another itinerary', async () => {
      load([makeDay(0), makeDay(1)]);

      await expect(
        service.reorder(OWNER, ITINERARY_ID, [DAY_ID[0], 'e'.repeat(24)]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('changes the city of one day', async () => {
      load([makeDay(0)]);

      await service.update(OWNER, ITINERARY_ID, DAY_ID[0], {
        cityId: 'cairo',
      });

      expect(itinerary.days[0].cityId).toBe('cairo');
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('refuses a city outside the itinerary countries', async () => {
      load([makeDay(0)]);
      referenceData.city.mockResolvedValue({
        city_id: 'paris',
        name: 'Paris',
        country_code: 'FR',
      });

      await expect(
        service.update(OWNER, ITINERARY_ID, DAY_ID[0], { cityId: 'paris' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stores a trimmed note on the day', async () => {
      load([makeDay(0)]);

      const result = await service.update(OWNER, ITINERARY_ID, DAY_ID[0], {
        notes: '  Museum in the morning.  ',
      });

      expect(itinerary.days[0].notes).toBe('Museum in the morning.');
      expect(result.notes).toBe('Museum in the morning.');
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('clears the note with an empty string', async () => {
      load([makeDay(0)]);
      itinerary.days[0].notes = 'Old note';

      await service.update(OWNER, ITINERARY_ID, DAY_ID[0], { notes: '' });

      expect(itinerary.days[0].notes).toBeUndefined();
    });

    it('rejects a request that changes nothing', async () => {
      load([makeDay(0)]);

      await expect(
        service.update(OWNER, ITINERARY_ID, DAY_ID[0], {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
