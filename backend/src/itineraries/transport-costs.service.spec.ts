import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { TransportCostsService } from './transport-costs.service';
import { ItinerariesService } from './itineraries.service';

const OWNER = 'a'.repeat(24);
const ITINERARY_ID = 'c'.repeat(24);
const COST_ID = [3, 4].map((n) => String(n).repeat(24));

type FakeCost = {
  _id?: string;
  fromCityId: string;
  toCityId: string;
  amount: number;
  date?: string;
  note?: string;
};

type FakeItinerary = {
  _id: string;
  ownerId: string;
  days: { _id: string; cityId: string }[];
  transportCosts: FakeCost[];
  save: jest.Mock;
};

const makeItinerary = (costs: FakeCost[] = []): FakeItinerary => ({
  _id: ITINERARY_ID,
  ownerId: OWNER,
  days: [
    { _id: '1'.repeat(24), cityId: 'cairo' },
    { _id: '2'.repeat(24), cityId: 'luxor' },
  ],
  transportCosts: costs,
  save: jest.fn().mockResolvedValue(undefined),
});

describe('TransportCostsService', () => {
  let service: TransportCostsService;
  let itinerary: FakeItinerary;
  let itineraries: {
    findOne: jest.Mock;
    findOneByTransportCost: jest.Mock;
  };

  const load = (costs: FakeCost[] = []) => {
    let nextId = 30;
    itinerary = makeItinerary(costs);
    itinerary.save.mockImplementation(async () => {
      itinerary.transportCosts.forEach((cost) => {
        if (!cost._id) {
          cost._id = String(nextId++).repeat(24).slice(0, 24);
        }
      });
    });
    itineraries.findOne.mockResolvedValue(itinerary);
    itineraries.findOneByTransportCost.mockResolvedValue(itinerary);
  };

  beforeEach(async () => {
    itineraries = { findOne: jest.fn(), findOneByTransportCost: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransportCostsService,
        { provide: ItinerariesService, useValue: itineraries },
      ],
    }).compile();

    service = module.get(TransportCostsService);
  });

  const dto = {
    fromCityId: 'cairo',
    toCityId: 'luxor',
    amount: 300,
    date: '2026-11-21',
  };

  describe('create', () => {
    it('appends a cost between two cities of the itinerary', async () => {
      load();

      const result = await service.create(OWNER, ITINERARY_ID, dto);

      expect(itinerary.transportCosts).toHaveLength(1);
      expect(itinerary.transportCosts[0]).toMatchObject(dto);
      expect(result).toMatchObject({
        fromCityId: 'cairo',
        toCityId: 'luxor',
        amount: 300,
      });
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('rejects the same city twice', async () => {
      load();

      await expect(
        service.create(OWNER, ITINERARY_ID, {
          ...dto,
          toCityId: 'cairo',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('rejects a city that is not a day of the itinerary', async () => {
      load();

      await expect(
        service.create(OWNER, ITINERARY_ID, { ...dto, toCityId: 'paris' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a negative amount', async () => {
      load();

      await expect(
        service.create(OWNER, ITINERARY_ID, { ...dto, amount: -5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an impossible date', async () => {
      load();

      await expect(
        service.create(OWNER, ITINERARY_ID, { ...dto, date: '2026-02-30' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('changes the amount', async () => {
      load([{ _id: COST_ID[0], ...dto }]);

      await service.update(OWNER, COST_ID[0], { amount: 350.75 });

      expect(itinerary.transportCosts[0].amount).toBe(350.75);
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('rejects moving a leg to the same city', async () => {
      load([{ _id: COST_ID[0], ...dto }]);

      await expect(
        service.update(OWNER, COST_ID[0], { toCityId: 'cairo' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('pulls the cost from the itinerary', async () => {
      load([
        { _id: COST_ID[0], ...dto },
        { _id: COST_ID[1], ...dto, amount: 100 },
      ]);

      await service.remove(OWNER, COST_ID[0]);

      expect(itinerary.transportCosts).toHaveLength(1);
      expect(itinerary.transportCosts[0]._id).toBe(COST_ID[1]);
    });

    it('throws NotFound for an unknown cost', async () => {
      load();

      await expect(
        service.remove(OWNER, COST_ID[0]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
