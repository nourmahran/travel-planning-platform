import { itineraryPdf } from './itinerary-pdf';
import type { ItineraryDetail } from './itinerary-detail';

describe('ITN-28 itinerary PDF', () => {
  it('renders a printable PDF with days, activities and transport', async () => {
    const itinerary = {
      title: 'Aswan weekend', startDate: '2026-12-01', countries: ['Egypt'], currency: 'USD',
      days: [{ dayNumber: 1, date: '2026-12-01', cityId: 'Aswan', activities: [{ title: 'Nile walk', startTime: '09:00', cost: 10 }], budgets: [{ category: 'food', amount: 20, currency: 'USD' }] }],
      transportCosts: [{ mode: 'train', fromCityId: 'Cairo', toCityId: 'Aswan', amount: 40, currency: 'USD' }],
    } as unknown as ItineraryDetail;
    const pdf = await itineraryPdf(itinerary);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
