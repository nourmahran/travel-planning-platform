import { FlightsService } from './flights.service';
import { FlightStatus } from './schemas/flight.schema';

describe('Flight details', () => {
  it('shows both airport-local times, duration, airline and cancellation tiers', async () => {
    const flight = {
      _id: '507f1f77bcf86cd799439011',
      airlineId: 'airline',
      status: FlightStatus.SCHEDULED,
      departureTimeUtc: new Date('2030-12-01T08:00:00Z'),
      arrivalTimeUtc: new Date('2030-12-01T12:30:00Z'),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'Asia/Dubai',
    };
    const airline = {
      _id: 'airline',
      name: 'Test Air',
      code: 'TA',
      flightPolicies: {
        cancellationTiers: [{ daysBefore: 0, refundPercent: 0 }],
      },
    };
    const service = new FlightsService(
      { findById: () => ({ exec: async () => flight }) } as never,
      { findById: () => ({ exec: async () => airline }) } as never,
      {} as never,
    );
    await expect(service.details(flight._id)).resolves.toMatchObject({
      airline: { name: 'Test Air', code: 'TA' },
      departureLocalTime: expect.stringContaining('10:00:00'),
      arrivalLocalTime: expect.stringContaining('16:30:00'),
      durationMinutes: 270,
      cancellationTiers: [{ daysBefore: 0, refundPercent: 0 }],
    });
  });
});
