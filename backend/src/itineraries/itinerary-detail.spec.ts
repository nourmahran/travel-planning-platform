import { toItineraryDetail } from './itinerary-detail';

const itinerary = {
  _id: 'c'.repeat(24),
  title: 'Cairo and Luxor',
  countries: ['EG'],
  startDate: '2026-11-20',
  currency: 'EGP',
  visibility: 'private',
  isHidden: false,
  cloneCount: 2,
  createdAt: new Date('2026-11-01T10:00:00.000Z'),
  updatedAt: new Date('2026-11-02T10:00:00.000Z'),
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
          startTime: '09:00',
          cost: 450,
          images: [
            {
              _id: '6'.repeat(24),
              url: 'https://cdn.example.com/pyramids.png',
              mimeType: 'image/png',
            },
          ],
        },
      ],
      budgets: [
        { _id: '5'.repeat(24), category: 'food', amount: 200, note: 'Lunch' },
      ],
    },
  ],
  transportCosts: [
    {
      _id: '7'.repeat(24),
      fromCityId: 'cairo',
      toCityId: 'luxor',
      amount: 300,
      date: '2026-11-21',
    },
  ],
};

describe('toItineraryDetail', () => {
  const detail = toItineraryDetail(
    itinerary as unknown as Parameters<typeof toItineraryDetail>[0],
  );

  it('keeps the list summary fields', () => {
    expect(detail).toMatchObject({
      id: itinerary._id,
      title: 'Cairo and Luxor',
      dayCount: 1,
      cloneCount: 2,
    });
  });

  it('maps days with activities, images and budget entries', () => {
    expect(detail.days).toHaveLength(1);
    expect(detail.days[0]).toMatchObject({
      id: '1'.repeat(24),
      dayNumber: 1,
      cityId: 'cairo',
      budgets: [{ id: '5'.repeat(24), category: 'food', amount: 200 }],
    });
    expect(detail.days[0].activities[0]).toMatchObject({
      id: '4'.repeat(24),
      title: 'Pyramids',
      images: [{ id: '6'.repeat(24), url: 'https://cdn.example.com/pyramids.png' }],
    });
  });

  it('maps transport costs, which are not part of a day', () => {
    expect(detail.transportCosts).toEqual([
      expect.objectContaining({
        id: '7'.repeat(24),
        fromCityId: 'cairo',
        toCityId: 'luxor',
        amount: 300,
      }),
    ]);
  });

  it('leaves clonedFrom undefined on an original itinerary', () => {
    expect(detail.clonedFrom).toBeUndefined();
    expect(detail.createdAt).toEqual(itinerary.createdAt);
  });
});
