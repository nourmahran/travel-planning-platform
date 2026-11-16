import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { ActivitiesService } from './activities.service';
import { ItinerariesService } from './itineraries.service';

const OWNER = 'a'.repeat(24);
const ITINERARY_ID = 'c'.repeat(24);
const DAY_ID = [1, 2, 3].map((n) => String(n).repeat(24));
const ACTIVITY_ID = [4, 5].map((n) => String(n).repeat(24));
const IMAGE_ID = [6, 7].map((n) => String(n).repeat(24));

type FakeImage = { _id?: string; url: string; mimeType?: string; sizeBytes?: number };

type FakeActivity = {
  _id?: string;
  title: string;
  attractionId?: string;
  startTime?: string;
  durationMinutes?: number;
  notes?: string;
  cost?: number;
  images: FakeImage[];
};

type FakeDay = {
  _id: string;
  dayNumber: number;
  date: string;
  cityId: string;
  activities: FakeActivity[];
  budgets: unknown[];
};

type FakeItinerary = {
  _id: string;
  ownerId: string;
  startDate: string;
  countries: string[];
  days: FakeDay[];
  save: jest.Mock;
};

const makeImage = (id: string): FakeImage => ({
  _id: id,
  url: `https://cdn.example.com/${id}.png`,
  mimeType: 'image/png',
  sizeBytes: 1024,
});

const makeActivity = (
  id: string | undefined,
  overrides: Partial<FakeActivity> = {},
): FakeActivity => ({
  _id: id,
  title: 'Pyramids of Giza',
  images: [],
  ...overrides,
});

const makeDay = (
  index: number,
  activities: FakeActivity[] = [],
): FakeDay => ({
  _id: DAY_ID[index],
  dayNumber: index + 1,
  date: '2026-11-20',
  cityId: 'cairo',
  activities,
  budgets: [],
});

const makeItinerary = (days: FakeDay[] = []): FakeItinerary => ({
  _id: ITINERARY_ID,
  ownerId: OWNER,
  startDate: '2026-11-20',
  countries: ['EG'],
  days,
  save: jest.fn().mockResolvedValue(undefined),
});

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let itinerary: FakeItinerary;
  let itineraries: { findOne: jest.Mock; findOneByActivity: jest.Mock };
  let nextId: number;

  const hex = (value: number) => String(value).repeat(24).slice(0, 24);

  const load = (days: FakeDay[]) => {
    nextId = 8;
    itinerary = makeItinerary(days);
    // Mongoose assigns _id to pushed subdocuments; the fake does it on save.
    itinerary.save.mockImplementation(async () => {
      itinerary.days.forEach((day) => {
        day.activities.forEach((activity) => {
          if (!activity._id) {
            activity._id = hex(nextId++);
          }
          activity.images.forEach((image) => {
            if (!image._id) {
              image._id = hex(nextId++);
            }
          });
        });
      });
    });
    itineraries.findOne.mockResolvedValue(itinerary);
    itineraries.findOneByActivity.mockResolvedValue(itinerary);

    return itinerary;
  };

  beforeEach(async () => {
    itineraries = {
      findOne: jest.fn(),
      findOneByActivity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        { provide: ItinerariesService, useValue: itineraries },
      ],
    }).compile();

    service = module.get(ActivitiesService);
  });

  describe('create', () => {
    const dto = {
      title: '  Pyramids of Giza  ',
      startTime: '09:00',
      durationMinutes: 180,
      cost: 450,
    };

    it('appends the activity to the day and returns it', async () => {
      load([makeDay(0)]);

      const result = await service.create(OWNER, ITINERARY_ID, DAY_ID[0], dto);

      expect(itinerary.days[0].activities).toHaveLength(1);
      expect(itinerary.days[0].activities[0]).toMatchObject({
        title: 'Pyramids of Giza',
        startTime: '09:00',
        durationMinutes: 180,
        cost: 450,
        images: [],
      });
      expect(itinerary.save).toHaveBeenCalled();
      expect(result).toMatchObject({
        id: expect.any(String),
        title: 'Pyramids of Giza',
        images: [],
      });
    });

    it('rejects the 21st activity of a day', async () => {
      load([
        makeDay(
          0,
          Array.from({ length: 20 }, (_value, index) =>
            makeActivity(hex(100 + index)),
          ),
        ),
      ]);

      await expect(
        service.create(OWNER, ITINERARY_ID, DAY_ID[0], dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itinerary.days[0].activities).toHaveLength(20);
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('rejects a malformed start time', async () => {
      load([makeDay(0)]);

      await expect(
        service.create(OWNER, ITINERARY_ID, DAY_ID[0], {
          ...dto,
          startTime: '25:00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a cost with three decimals', async () => {
      load([makeDay(0)]);

      await expect(
        service.create(OWNER, ITINERARY_ID, DAY_ID[0], { ...dto, cost: 12.345 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a negative cost', async () => {
      load([makeDay(0)]);

      await expect(
        service.create(OWNER, ITINERARY_ID, DAY_ID[0], { ...dto, cost: -1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound for a day of another itinerary', async () => {
      load([makeDay(0)]);

      await expect(
        service.create(OWNER, ITINERARY_ID, 'f'.repeat(24), dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies the editable fields', async () => {
      load([makeDay(0, [makeActivity(ACTIVITY_ID[0])])]);

      const result = await service.update(OWNER, ACTIVITY_ID[0], {
        title: '  Sound and light show  ',
        notes: 'Evening',
        cost: 300.5,
      });

      expect(itinerary.days[0].activities[0]).toMatchObject({
        title: 'Sound and light show',
        notes: 'Evening',
        cost: 300.5,
      });
      expect(result).toMatchObject({ title: 'Sound and light show' });
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('rejects a malformed start time', async () => {
      load([makeDay(0, [makeActivity(ACTIVITY_ID[0])])]);

      await expect(
        service.update(OWNER, ACTIVITY_ID[0], { startTime: '9:5' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('pulls the activity from its day', async () => {
      load([
        makeDay(0, [
          makeActivity(ACTIVITY_ID[0]),
          makeActivity(ACTIVITY_ID[1]),
        ]),
      ]);

      await service.remove(OWNER, ACTIVITY_ID[0]);

      expect(itinerary.days[0].activities).toHaveLength(1);
      expect(itinerary.days[0].activities[0]._id).toBe(ACTIVITY_ID[1]);
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('throws NotFound for an unknown activity', async () => {
      load([makeDay(0, [makeActivity(ACTIVITY_ID[0])])]);

      await expect(
        service.remove(OWNER, 'e'.repeat(24)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('images', () => {
    const dto = {
      url: 'https://cdn.example.com/pyramids.png',
      mimeType: 'image/png' as const,
      sizeBytes: 1024,
    };

    it('appends an image and returns it', async () => {
      load([makeDay(0, [makeActivity(ACTIVITY_ID[0])])]);

      const result = await service.addImage(OWNER, ACTIVITY_ID[0], dto);

      expect(itinerary.days[0].activities[0].images).toHaveLength(1);
      expect(result).toMatchObject({ url: dto.url, id: expect.any(String) });
      expect(itinerary.save).toHaveBeenCalled();
    });

    it('rejects a file that is not JPG or PNG', async () => {
      load([makeDay(0, [makeActivity(ACTIVITY_ID[0])])]);

      await expect(
        service.addImage(OWNER, ACTIVITY_ID[0], {
          ...dto,
          mimeType: 'image/gif' as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itinerary.days[0].activities[0].images).toHaveLength(0);
    });

    it('rejects an image over 5 MB', async () => {
      load([makeDay(0, [makeActivity(ACTIVITY_ID[0])])]);

      await expect(
        service.addImage(OWNER, ACTIVITY_ID[0], {
          ...dto,
          sizeBytes: 5 * 1024 * 1024 + 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itinerary.days[0].activities[0].images).toHaveLength(0);
    });

    it('rejects an image with no recorded size', async () => {
      load([makeDay(0, [makeActivity(ACTIVITY_ID[0])])]);

      await expect(
        service.addImage(OWNER, ACTIVITY_ID[0], {
          ...dto,
          sizeBytes: undefined as unknown as number,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects the 6th image of an activity', async () => {
      load([
        makeDay(0, [
          makeActivity(ACTIVITY_ID[0], {
            images: IMAGE_ID.concat([8, 9, 10].map((n) => hex(n))).map((id) =>
              makeImage(id),
            ),
          }),
        ]),
      ]);

      await expect(
        service.addImage(OWNER, ACTIVITY_ID[0], dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itinerary.days[0].activities[0].images).toHaveLength(5);
    });

    it('pulls an image by id', async () => {
      load([
        makeDay(0, [
          makeActivity(ACTIVITY_ID[0], {
            images: [makeImage(IMAGE_ID[0]), makeImage(IMAGE_ID[1])],
          }),
        ]),
      ]);

      await service.removeImage(OWNER, ACTIVITY_ID[0], IMAGE_ID[0]);

      expect(itinerary.days[0].activities[0].images).toHaveLength(1);
      expect(itinerary.days[0].activities[0].images[0]._id).toBe(IMAGE_ID[1]);
    });

    it('throws NotFound for an unknown image', async () => {
      load([makeDay(0, [makeActivity(ACTIVITY_ID[0])])]);

      await expect(
        service.removeImage(OWNER, ACTIVITY_ID[0], IMAGE_ID[0]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
