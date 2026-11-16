import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { BudgetsService } from './budgets.service';
import { ItinerariesService } from './itineraries.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';

const OWNER = 'a'.repeat(24);
const ITINERARY_ID = 'c'.repeat(24);
const DAY_ID = [1, 2].map((n) => String(n).repeat(24));
const BUDGET_ID = [3, 4].map((n) => String(n).repeat(24));

type FakeBudget = {
  _id?: string;
  category: string;
  amount: number;
  currency?: string;
  note?: string;
};

type FakeDay = {
  _id: string;
  dayNumber: number;
  date: string;
  cityId: string;
  activities: unknown[];
  budgets: FakeBudget[];
};

type FakeItinerary = {
  _id: string;
  ownerId: string;
  currency: string;
  days: FakeDay[];
  save: jest.Mock;
};

const makeDay = (index: number, budgets: FakeBudget[] = []): FakeDay => ({
  _id: DAY_ID[index],
  dayNumber: index + 1,
  date: '2026-11-20',
  cityId: 'cairo',
  activities: [],
  budgets,
});

const makeItinerary = (days: FakeDay[] = []): FakeItinerary => ({
  _id: ITINERARY_ID,
  ownerId: OWNER,
  currency: 'EGP',
  days,
  save: jest.fn().mockResolvedValue(undefined),
});

describe('BudgetsService', () => {
  let service: BudgetsService;
  let itinerary: FakeItinerary;
  let itineraries: { findOne: jest.Mock; findOneByBudget: jest.Mock };
  let referenceData: { displayCurrencies: jest.Mock };

  const load = (days: FakeDay[]) => {
    let nextId = 20;
    itinerary = makeItinerary(days);
    itinerary.save.mockImplementation(async () => {
      itinerary.days.forEach((day) => {
        day.budgets.forEach((budget) => {
          if (!budget._id) {
            budget._id = String(nextId++).repeat(24).slice(0, 24);
          }
        });
      });
    });
    itineraries.findOne.mockResolvedValue(itinerary);
    itineraries.findOneByBudget.mockResolvedValue(itinerary);
  };

  beforeEach(async () => {
    itineraries = { findOne: jest.fn(), findOneByBudget: jest.fn() };
    referenceData = {
      displayCurrencies: jest.fn().mockResolvedValue(['AED', 'EGP', 'USD']),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetsService,
        { provide: ItinerariesService, useValue: itineraries },
        { provide: ReferenceDataService, useValue: referenceData },
      ],
    }).compile();

    service = module.get(BudgetsService);
  });

  describe('create', () => {
    it('appends a budget entry to the day and returns it', async () => {
      load([makeDay(0)]);

      const result = await service.create(OWNER, ITINERARY_ID, DAY_ID[0], {
        category: 'food',
        amount: 200.5,
        note: '  Lunch  ',
      });

      expect(itinerary.days[0].budgets).toHaveLength(1);
      expect(itinerary.days[0].budgets[0]).toMatchObject({
        category: 'food',
        amount: 200.5,
        currency: 'EGP',
        note: 'Lunch',
      });
      expect(result).toMatchObject({
        category: 'food',
        amount: 200.5,
        currency: 'EGP',
      });
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('keeps the currency the client sent, uppercased (ITN-14)', async () => {
      load([makeDay(0)]);

      const result = await service.create(OWNER, ITINERARY_ID, DAY_ID[0], {
        category: 'accommodation',
        amount: 40,
        currency: 'usd',
      });

      expect(itinerary.days[0].budgets[0]).toMatchObject({
        amount: 40,
        currency: 'USD',
      });
      expect(result).toMatchObject({ amount: 40, currency: 'USD' });
    });

    it('rejects a currency the reference dataset cannot serve', async () => {
      load([makeDay(0)]);

      await expect(
        service.create(OWNER, ITINERARY_ID, DAY_ID[0], {
          category: 'food',
          amount: 10,
          currency: 'CHF',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('accepts a supported currency the country list does not carry', async () => {
      referenceData.displayCurrencies.mockResolvedValue([
        'AED',
        'CAD',
        'EGP',
        'USD',
      ]);
      load([makeDay(0)]);

      const result = await service.create(OWNER, ITINERARY_ID, DAY_ID[0], {
        category: 'food',
        amount: 40,
        currency: 'cad',
      });

      expect(result).toMatchObject({ amount: 40, currency: 'CAD' });
      expect(itinerary.days[0].budgets[0]).toMatchObject({ currency: 'CAD' });
    });

    it('rejects a negative amount', async () => {
      load([makeDay(0)]);

      await expect(
        service.create(OWNER, ITINERARY_ID, DAY_ID[0], {
          category: 'food',
          amount: -1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('rejects an amount with three decimals', async () => {
      load([makeDay(0)]);

      await expect(
        service.create(OWNER, ITINERARY_ID, DAY_ID[0], {
          category: 'food',
          amount: 12.345,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unknown category', async () => {
      load([makeDay(0)]);

      await expect(
        service.create(OWNER, ITINERARY_ID, DAY_ID[0], {
          category: 'souvenirs' as never,
          amount: 50,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound for a day of another itinerary', async () => {
      load([makeDay(0)]);

      await expect(
        service.create(OWNER, ITINERARY_ID, 'f'.repeat(24), {
          category: 'food',
          amount: 10,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies the amount and the note', async () => {
      load([
        makeDay(0, [{ _id: BUDGET_ID[0], category: 'food', amount: 200 }]),
      ]);

      await service.update(OWNER, BUDGET_ID[0], {
        amount: 250,
        note: 'Dinner',
      });

      expect(itinerary.days[0].budgets[0]).toMatchObject({
        category: 'food',
        amount: 250,
        note: 'Dinner',
      });
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('rejects an unknown category', async () => {
      load([
        makeDay(0, [{ _id: BUDGET_ID[0], category: 'food', amount: 200 }]),
      ]);

      await expect(
        service.update(OWNER, BUDGET_ID[0], { category: 'souvenirs' as never }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('changes the currency of an existing entry (ITN-14)', async () => {
      load([
        makeDay(0, [
          {
            _id: BUDGET_ID[0],
            category: 'food',
            amount: 200,
            currency: 'EGP',
          },
        ]),
      ]);

      const result = await service.update(OWNER, BUDGET_ID[0], {
        currency: 'usd',
      });

      expect(itinerary.days[0].budgets[0]).toMatchObject({ currency: 'USD' });
      expect(result).toMatchObject({ currency: 'USD' });
    });

    it('rejects a three-decimal amount', async () => {
      load([
        makeDay(0, [{ _id: BUDGET_ID[0], category: 'food', amount: 200 }]),
      ]);

      await expect(
        service.update(OWNER, BUDGET_ID[0], { amount: 1.005 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('pulls the entry from its day', async () => {
      load([
        makeDay(0, [
          { _id: BUDGET_ID[0], category: 'food', amount: 200 },
          { _id: BUDGET_ID[1], category: 'accommodation', amount: 900 },
        ]),
      ]);

      await service.remove(OWNER, BUDGET_ID[0]);

      expect(itinerary.days[0].budgets).toHaveLength(1);
      expect(itinerary.days[0].budgets[0]._id).toBe(BUDGET_ID[1]);
    });

    it('throws NotFound for an unknown budget entry', async () => {
      load([makeDay(0)]);

      await expect(
        service.remove(OWNER, BUDGET_ID[0]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
