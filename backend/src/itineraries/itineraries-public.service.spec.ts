import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { ItinerariesPublicService } from './itineraries-public.service';
import { Itinerary } from './schemas/itinerary.schema';
import { ReferenceDataService } from '../reference-data/reference-data.service';

const OWNER = 'a'.repeat(24);
const OTHER = 'b'.repeat(24);
const ITINERARY_ID = 'c'.repeat(24);

type FakeItinerary = {
  _id: string;
  ownerId: string;
  title: string;
  countries: string[];
  startDate: string;
  currency: string;
  visibility: string;
  isHidden: boolean;
  cloneCount: number;
  updatedAt: Date;
  days: {
    _id: string;
    dayNumber: number;
    date: string;
    cityId: string;
    activities: {
      _id: string;
      title: string;
      images: { _id: string; url: string }[];
    }[];
    budgets: { category: string; amount: number }[];
  }[];
  transportCosts: { fromCityId: string; toCityId: string; amount: number }[];
  clonedFrom?: {
    itineraryId: string;
    authorId: string;
    authorName: string;
    clonedAt: Date;
  };
};

const makeItinerary = (
  overrides: Partial<FakeItinerary> = {},
): FakeItinerary => ({
  _id: ITINERARY_ID,
  ownerId: OWNER,
  title: 'Cairo and Luxor',
  countries: ['EG'],
  startDate: '2026-11-20',
  currency: 'EGP',
  visibility: 'public',
  isHidden: false,
  cloneCount: 3,
  updatedAt: new Date('2026-11-10T10:00:00.000Z'),
  days: [
    {
      _id: '1'.repeat(24),
      dayNumber: 1,
      date: '2026-11-20',
      cityId: 'cairo',
      activities: [
        {
          _id: '4'.repeat(24),
          title: 'Pyramids',
          images: [{ _id: '5'.repeat(24), url: 'https://cdn.example.com/p.png' }],
        },
      ],
      budgets: [{ category: 'food', amount: 200 }],
    },
  ],
  transportCosts: [{ fromCityId: 'cairo', toCityId: 'luxor', amount: 300 }],
  ...overrides,
});

describe('ItinerariesPublicService', () => {
  let service: ItinerariesPublicService;
  let model: {
    find: jest.Mock;
    countDocuments: jest.Mock;
    findById: jest.Mock;
  };
  let referenceData: {
    citiesInCountries: jest.Mock;
    userNames: jest.Mock;
  };

  const searchReturns = (items: FakeItinerary[], total: number) => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(items),
    };

    model.find.mockReturnValue(chain);
    model.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(total),
    });

    return chain;
  };

  const detailReturns = (value: FakeItinerary | null) => {
    model.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(value),
    });
  };

  beforeEach(async () => {
    model = { find: jest.fn(), countDocuments: jest.fn(), findById: jest.fn() };
    referenceData = {
      citiesInCountries: jest.fn().mockResolvedValue([
        { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      ]),
      userNames: jest.fn().mockResolvedValue(
        new Map([
          [OWNER, 'Sara'],
          [OTHER, 'Omar'],
        ]),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItinerariesPublicService,
        { provide: getModelToken(Itinerary.name), useValue: model },
        { provide: ReferenceDataService, useValue: referenceData },
      ],
    }).compile();

    service = module.get(ItinerariesPublicService);
  });

  describe('search', () => {
    const filterOf = () => model.find.mock.calls[0][0] as Record<string, unknown>;

    it('only matches public, non-hidden itineraries', async () => {
      searchReturns([makeItinerary()], 1);

      const result = await service.search({});

      expect(filterOf()).toEqual({
        visibility: 'public',
        isHidden: { $ne: true },
      });
      expect(result).toMatchObject({ total: 1, page: 1, limit: 10, totalPages: 1 });
      expect(result.items[0]).toMatchObject({
        id: ITINERARY_ID,
        author: { id: OWNER, name: 'Sara' },
      });
    });

    it('escapes the title search and keeps it case-insensitive', async () => {
      searchReturns([], 0);

      await service.search({ q: 'cairo (2+ nights)' });

      expect(filterOf().title).toEqual({
        $regex: 'cairo \\(2\\+ nights\\)',
        $options: 'i',
      });
    });

    it('filters by country, city and author', async () => {
      searchReturns([], 0);

      await service.search({
        country: 'eg',
        city: 'cairo',
        authorId: OWNER,
      });

      expect(filterOf()).toMatchObject({
        countries: 'EG',
        'days.cityId': 'cairo',
      });
      expect(String(filterOf().ownerId)).toBe(OWNER);
    });

    it('filters by the number of days', async () => {
      searchReturns([], 0);

      await service.search({ minDays: 2, maxDays: 5 });

      expect(filterOf().$expr).toEqual({
        $and: [
          { $gte: [{ $size: { $ifNull: ['$days', []] } }, 2] },
          { $lte: [{ $size: { $ifNull: ['$days', []] } }, 5] },
        ],
      });
    });

    it('sorts by newest by default and by popularity on request', async () => {
      const chain = searchReturns([], 0);

      await service.search({});
      expect(chain.sort).toHaveBeenLastCalledWith({ updatedAt: -1 });

      await service.search({ sort: 'popular' });
      expect(chain.sort).toHaveBeenLastCalledWith({
        cloneCount: -1,
        updatedAt: -1,
      });
    });

    it('paginates with a page size of 10', async () => {
      const chain = searchReturns([], 0);

      await service.search({ page: 3, limit: 5 });

      expect(chain.skip).toHaveBeenCalledWith(10);
      expect(chain.limit).toHaveBeenCalledWith(5);
    });
  });

  describe('detail', () => {
    it('throws NotFound for a private itinerary', async () => {
      detailReturns(makeItinerary({ visibility: 'private' }));

      await expect(service.detail(ITINERARY_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFound for a hidden public itinerary', async () => {
      detailReturns(makeItinerary({ isHidden: true }));

      await expect(service.detail(ITINERARY_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFound for an unknown id', async () => {
      detailReturns(null);

      await expect(service.detail(ITINERARY_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns days with city names and activities, and the author name', async () => {
      detailReturns(makeItinerary());

      const detail = await service.detail(ITINERARY_ID);

      expect(detail).toMatchObject({
        id: ITINERARY_ID,
        title: 'Cairo and Luxor',
        author: { id: OWNER, name: 'Sara' },
      });
      expect(detail.days[0]).toMatchObject({
        dayNumber: 1,
        city: { id: 'cairo', name: 'Cairo', countryCode: 'EG' },
        activities: [{ id: '4'.repeat(24), title: 'Pyramids' }],
      });
      expect(detail.days[0]).not.toHaveProperty('budgets');
      expect(detail).not.toHaveProperty('totals');
      expect(detail.originalAuthor).toBeUndefined();
    });

    it('credits the original author of a clone', async () => {
      detailReturns(
        makeItinerary({
          clonedFrom: {
            itineraryId: 'd'.repeat(24),
            authorId: OTHER,
            authorName: 'Omar',
            clonedAt: new Date('2026-11-09T10:00:00.000Z'),
          },
        }),
      );

      const detail = await service.detail(ITINERARY_ID);

      expect(detail.originalAuthor).toEqual({ id: OTHER, name: 'Omar' });
    });
  });
});
