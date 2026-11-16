import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { ItinerariesService } from './itineraries.service';
import { Itinerary } from './schemas/itinerary.schema';
import { ReferenceDataService } from '../reference-data/reference-data.service';

const OWNER = 'a'.repeat(24);
const OTHER = 'b'.repeat(24);
const ITINERARY_ID = 'c'.repeat(24);
const TODAY = new Date().toISOString().slice(0, 10);

type FakeItinerary = {
  _id: string;
  ownerId: string;
  title: string;
  countries: string[];
  startDate: string;
  currency: string;
  visibility: string;
  isHidden: boolean;
  days: { cityId: string; dayNumber?: number; date?: string }[];
  transportCosts: unknown[];
  cloneCount: number;
  save: jest.Mock;
  deleteOne: jest.Mock;
};

const makeItinerary = (overrides: Partial<FakeItinerary> = {}): FakeItinerary => ({
  _id: ITINERARY_ID,
  ownerId: OWNER,
  title: 'Cairo and Luxor',
  countries: ['EG'],
  startDate: TODAY,
  currency: 'EGP',
  visibility: 'private',
  isHidden: false,
  days: [],
  transportCosts: [],
  cloneCount: 0,
  save: jest.fn().mockResolvedValue(undefined),
  deleteOne: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('ItinerariesService', () => {
  let service: ItinerariesService;
  let model: {
    create: jest.Mock;
    findById: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    updateOne: jest.Mock;
  };
  let referenceData: {
    countryCodes: jest.Mock;
    currencyOfCountry: jest.Mock;
    displayCurrencies: jest.Mock;
    citiesInCountries: jest.Mock;
    userName: jest.Mock;
  };

  const findByIdReturns = (value: FakeItinerary | null) => {
    model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(value) });
  };

  const findReturns = (items: FakeItinerary[], total: number) => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(items),
    };

    model.find.mockReturnValue(chain);
    model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(total) });

    return chain;
  };

  beforeEach(async () => {
    model = {
      create: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      updateOne: jest.fn(),
    };

    referenceData = {
      countryCodes: jest.fn().mockResolvedValue(['EG', 'FR']),
      currencyOfCountry: jest.fn().mockResolvedValue('EGP'),
      displayCurrencies: jest.fn().mockResolvedValue(['EGP', 'EUR', 'USD']),
      citiesInCountries: jest.fn().mockResolvedValue([]),
      userName: jest.fn().mockResolvedValue('Sara'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItinerariesService,
        { provide: getModelToken(Itinerary.name), useValue: model },
        { provide: ReferenceDataService, useValue: referenceData },
      ],
    }).compile();

    service = module.get(ItinerariesService);
  });

  describe('create', () => {
    const dto = {
      title: '  Cairo and Luxor  ',
      countries: ['EG'],
      startDate: TODAY,
    };

    it('stores the owner, a private visibility and zero counters', async () => {
      model.create.mockImplementation((payload: Record<string, unknown>) =>
        Promise.resolve(makeItinerary(payload as Partial<FakeItinerary>)),
      );

      await service.create(OWNER, dto as never);

      const payload = model.create.mock.calls[0][0] as Record<string, unknown>;

      expect(String(payload.ownerId)).toBe(OWNER);
      expect(payload).toMatchObject({
        title: 'Cairo and Luxor',
        visibility: 'private',
        isHidden: false,
        cloneCount: 0,
        days: [],
        transportCosts: [],
      });
    });

    it('defaults the currency to the first country currency', async () => {
      model.create.mockImplementation((payload: Record<string, unknown>) =>
        Promise.resolve(makeItinerary(payload as Partial<FakeItinerary>)),
      );

      await service.create(OWNER, dto as never);

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'EGP' }),
      );
    });

    it('rejects a country that is not in the reference collection', async () => {
      referenceData.countryCodes.mockResolvedValue(['FR']);

      await expect(service.create(OWNER, dto as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(model.create).not.toHaveBeenCalled();
    });

    it('rejects a currency that is not a display currency', async () => {
      await expect(
        service.create(OWNER, { ...dto, currency: 'XYZ' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a start date before today', async () => {
      await expect(
        service.create(OWNER, { ...dto, startDate: '2020-01-01' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an impossible calendar date', async () => {
      await expect(
        service.create(OWNER, { ...dto, startDate: '2027-02-30' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('throws NotFound for an unknown id', async () => {
      findByIdReturns(null);

      await expect(service.findOne(OWNER, ITINERARY_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Forbidden for another owner', async () => {
      findByIdReturns(makeItinerary({ ownerId: OTHER }));

      await expect(service.findOne(OWNER, ITINERARY_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns the document for its owner', async () => {
      findByIdReturns(makeItinerary());

      await expect(service.findOne(OWNER, ITINERARY_ID)).resolves.toMatchObject({
        _id: ITINERARY_ID,
      });
    });
  });

  describe('findOneByActivity', () => {
    const findByActivity = (value: FakeItinerary | null) => {
      model.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(value),
      });
    };

    it('throws NotFound for an unknown activity', async () => {
      findByActivity(null);

      await expect(
        service.findOneByActivity(OWNER, 'd'.repeat(24)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden when the activity belongs to another owner', async () => {
      findByActivity(makeItinerary({ ownerId: OTHER }));

      await expect(
        service.findOneByActivity(OWNER, 'd'.repeat(24)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns the parent itinerary and queries the nested activity id', async () => {
      findByActivity(makeItinerary());

      await expect(
        service.findOneByActivity(OWNER, 'd'.repeat(24)),
      ).resolves.toMatchObject({ _id: ITINERARY_ID });
      expect(model.findOne).toHaveBeenCalledWith({
        'days.activities._id': expect.anything(),
      });
    });
  });

  describe('findOneByBudget and findOneByTransportCost', () => {
    const findByNested = (value: FakeItinerary | null) => {
      model.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(value),
      });
    };

    it('queries the nested budget path and enforces ownership', async () => {
      findByNested(makeItinerary({ ownerId: OTHER }));

      await expect(
        service.findOneByBudget(OWNER, 'd'.repeat(24)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(model.findOne).toHaveBeenCalledWith({
        'days.budgets._id': expect.anything(),
      });
    });

    it('queries the transport cost path and enforces ownership', async () => {
      findByNested(makeItinerary({ ownerId: OTHER }));

      await expect(
        service.findOneByTransportCost(OWNER, 'd'.repeat(24)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(model.findOne).toHaveBeenCalledWith({
        'transportCosts._id': expect.anything(),
      });
    });

    it('throws NotFound when the nested id matches nothing', async () => {
      findByNested(null);

      await expect(
        service.findOneByBudget(OWNER, 'd'.repeat(24)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    it('scopes the query to the owner and paginates', async () => {
      const chain = findReturns([makeItinerary()], 1);

      const result = await service.list(OWNER, { page: 2, limit: 5 });

      const filter = model.find.mock.calls[0][0] as { ownerId: unknown };

      expect(String(filter.ownerId)).toBe(OWNER);
      expect(chain.sort).toHaveBeenCalledWith({ updatedAt: -1 });
      expect(chain.skip).toHaveBeenCalledWith(5);
      expect(chain.limit).toHaveBeenCalledWith(5);
      expect(result).toMatchObject({ total: 1, page: 2, limit: 5, totalPages: 1 });
      expect(result.items).toHaveLength(1);
    });

    it('returns an empty page rather than an error when nothing matches', async () => {
      findReturns([], 0);

      await expect(service.list(OWNER, {})).resolves.toMatchObject({
        items: [],
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('update', () => {
    it('applies the visibility change', async () => {
      const itinerary = makeItinerary();
      findByIdReturns(itinerary);

      await service.update(OWNER, ITINERARY_ID, { visibility: 'public' });

      expect(itinerary.visibility).toBe('public');
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('rejects a country change that would orphan a day city', async () => {
      const itinerary = makeItinerary({
        countries: ['EG', 'FR'],
        days: [{ cityId: 'paris' }],
      });
      findByIdReturns(itinerary);
      referenceData.citiesInCountries.mockResolvedValue([]);

      await expect(
        service.update(OWNER, ITINERARY_ID, { countries: ['EG'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });
    it('recalculates the day dates when the start date moves', async () => {
      const itinerary = makeItinerary({
        days: [
          { cityId: 'cairo', dayNumber: 1, date: '2026-11-20' },
          { cityId: 'cairo', dayNumber: 2, date: '2026-11-21' },
        ],
      });
      findByIdReturns(itinerary);

      await service.update(OWNER, ITINERARY_ID, { startDate: '2027-03-01' });

      expect(itinerary.days.map((day) => day.date)).toEqual([
        '2027-03-01',
        '2027-03-02',
      ]);
    });
  });

  describe('clone', () => {
    const source = () =>
      makeItinerary({
        visibility: 'public',
        startDate: '2026-11-20',
        days: [
          { cityId: 'cairo', dayNumber: 1, date: '2026-11-20' },
          { cityId: 'cairo', dayNumber: 2, date: '2026-11-21' },
        ],
      });

    const cloneSource = (itinerary: FakeItinerary) => {
      findByIdReturns(itinerary);
      model.create.mockImplementation((payload: Record<string, unknown>) =>
        Promise.resolve({
          ...makeItinerary(),
          ...payload,
          _id: 'e'.repeat(24),
        }),
      );
      model.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      });
    };

    it('copies a public itinerary into a private copy with attribution', async () => {
      const itinerary = source();
      cloneSource(itinerary);

      await service.clone(OTHER, ITINERARY_ID, {});

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Copy of Cairo and Luxor',
          countries: ['EG'],
          startDate: '2026-11-20',
          visibility: 'private',
          isHidden: false,
          cloneCount: 0,
        }),
      );
      const payload = model.create.mock.calls[0][0] as {
        ownerId: unknown;
        clonedFrom: { authorId: unknown; authorName: string };
      };
      expect(String(payload.ownerId)).toBe(OTHER);
      expect(String(payload.clonedFrom.authorId)).toBe(OWNER);
      expect(payload.clonedFrom.authorName).toBe('Sara');
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: itinerary._id },
        { $inc: { cloneCount: 1 } },
      );
    });

    it('copies days as new objects without reusing their ids', async () => {
      const itinerary = source();
      cloneSource(itinerary);

      await service.clone(OTHER, ITINERARY_ID, {});

      const payload = model.create.mock.calls[0][0] as {
        days: Record<string, unknown>[];
      };
      expect(payload.days).toHaveLength(2);
      expect(payload.days[0]).not.toBe(itinerary.days[0]);
      expect(payload.days[0]).not.toHaveProperty('_id');
      expect(payload.days[0]).toMatchObject({ cityId: 'cairo', dayNumber: 1 });
    });

    it('honours a title and a start date override, recalculating the day dates', async () => {
      cloneSource(source());

      await service.clone(OTHER, ITINERARY_ID, {
        title: '  My Egypt trip  ',
        startDate: '2027-03-01',
      });

      const payload = model.create.mock.calls[0][0] as {
        title: string;
        days: { date: string }[];
      };
      expect(payload.title).toBe('My Egypt trip');
      expect(payload.days.map((day) => day.date)).toEqual([
        '2027-03-01',
        '2027-03-02',
      ]);
    });

    it('refuses a private itinerary of another user', async () => {
      cloneSource(makeItinerary({ visibility: 'private' }));

      await expect(service.clone(OTHER, ITINERARY_ID, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(model.create).not.toHaveBeenCalled();
    });

    it('allows cloning an owned private itinerary', async () => {
      cloneSource(makeItinerary({ visibility: 'private' }));

      await expect(service.clone(OWNER, ITINERARY_ID, {})).resolves.toBeDefined();
      expect(model.create).toHaveBeenCalled();
    });

    it('refuses a hidden public itinerary', async () => {
      cloneSource(makeItinerary({ visibility: 'public', isHidden: true }));

      await expect(service.clone(OTHER, ITINERARY_ID, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes an owned itinerary', async () => {
      const itinerary = makeItinerary();
      findByIdReturns(itinerary);

      await service.remove(OWNER, ITINERARY_ID);

      expect(itinerary.deleteOne).toHaveBeenCalled();
    });

    it('refuses to delete another owner itinerary', async () => {
      const itinerary = makeItinerary({ ownerId: OTHER });
      findByIdReturns(itinerary);

      await expect(service.remove(OWNER, ITINERARY_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(itinerary.deleteOne).not.toHaveBeenCalled();
    });
  });
});
