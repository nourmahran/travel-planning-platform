import { BudgetSummaryService } from './budget-summary.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';

const ownerId = 'a'.repeat(24);

const created = {
  _id: 'c'.repeat(24),
  title: 'Cairo and Dubai',
  countries: ['EG', 'AE'],
  startDate: '2026-12-01',
  currency: 'EGP',
  visibility: 'private',
  isHidden: false,
  cloneCount: 0,
  createdAt: new Date('2026-11-01T10:00:00.000Z'),
  updatedAt: new Date('2026-11-01T10:00:00.000Z'),
  days: [],
  transportCosts: [],
};

describe('ItinerariesController', () => {
  const create = jest.fn().mockResolvedValue(created);
  const controller = new ItinerariesController(
    { create } as unknown as ItinerariesService,
    {} as BudgetSummaryService,
  );

  it('answers POST /itineraries with the detail object, not the stored document', async () => {
    const response = await controller.create(ownerId, {
      title: 'Cairo and Dubai',
      countries: ['EG', 'AE'],
      startDate: '2026-12-01',
      currency: 'EGP',
    } as unknown as CreateItineraryDto);

    expect(response).toMatchObject({
      id: created._id,
      title: 'Cairo and Dubai',
      dayCount: 0,
      cloneCount: 0,
      days: [],
      transportCosts: [],
    });
    expect(response).not.toHaveProperty('_id');
    expect(response).not.toHaveProperty('__v');
    expect(create).toHaveBeenCalledWith(ownerId, expect.any(Object));
  });
});
