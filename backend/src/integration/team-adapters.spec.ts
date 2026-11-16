import { Types } from 'mongoose';
import { BookingStatus, BookingType } from '../common/booking';
import { TeamIdentity } from '../community/team-identity';
import { TeamBridge } from '../community/team.bridge';
import { HotelBookingGateway } from '../hotels/hotel-booking.gateway';
import { TeamHotelSearchPort } from '../itineraries/team-hotel-search.port';
import { TeamHotelPayments } from '../hotels/integrations/team-adapters';
import { RefundReason } from '../payments/schemas/refund.schema';

const bookingId = new Types.ObjectId();
const userId = new Types.ObjectId();

describe('cross-member adapters', () => {
  it('maps the hotel hold, amount and cancellation policy into the payment contract', async () => {
    const booking = {
      _id: bookingId,
      userId,
      status: 'HELD',
      totalAmountCents: 12345,
      currency: 'USD',
      holdExpiresAt: new Date('2026-12-01T10:10:00Z'),
      policiesAcceptedAt: new Date('2026-12-01T10:01:00Z'),
      checkIn: '2026-12-10',
      reference: 'HB-123',
      policySnapshot: {
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ minDaysBeforeCheckIn: 7, refundPercent: 100 }],
      },
    };
    const model = {
      findById: jest.fn().mockReturnValue({ exec: async () => booking }),
    };
    const gateway = new HotelBookingGateway(
      model as never,
      {} as never,
      { register: jest.fn() } as never,
    );
    const view = await gateway.findById(bookingId.toString());
    expect(view).toMatchObject({
      type: BookingType.Hotel,
      userId: userId.toString(),
      status: BookingStatus.PendingPayment,
      totalAmount: 123.45,
      currency: 'usd',
      policySnapshot: {
        kind: 'hotel',
        cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
      },
    });
  });

  it('routes a provider hotel cancellation to a full Stripe refund', async () => {
    const refunds = {
      issueRefund: jest
        .fn()
        .mockResolvedValue({ status: 'Refunded', stripeRefundId: 're_test' }),
    };
    const adapter = new TeamHotelPayments(refunds as never, {} as never);
    const result = await adapter.refundHotelBooking({
      bookingId: bookingId.toString(),
      bookingReference: 'HB-123',
      userId: userId.toString(),
      amountCents: 12345,
      currency: 'USD',
      reason: 'Provider cancelled',
      providerInitiated: true,
    });
    expect(refunds.issueRefund).toHaveBeenCalledWith(
      BookingType.Hotel,
      bookingId.toString(),
      RefundReason.ProviderCancellation,
    );
    expect(result).toEqual({
      status: 'REFUNDED',
      providerRefundId: 're_test',
      failureReason: undefined,
    });
  });

  it('derives community identity from the verified Member 1 request', async () => {
    const identity = new TeamIdentity();
    expect(
      await identity.resolve({
        user: {
          id: userId.toString(),
          name: 'Moderator',
          role: 'hotel_moderator',
          providerType: 'hotel',
          providerId: bookingId.toString(),
        },
      } as never),
    ).toMatchObject({
      id: userId.toString(),
      assignedHotelId: bookingId.toString(),
    });
    expect(
      await identity.resolve({
        headers: { 'x-user-id': userId.toString() },
      } as never),
    ).toBeUndefined();
  });

  it('reads Member 5 public itineraries using ownerId, lowercase visibility and isHidden', async () => {
    const find = jest
      .fn()
      .mockReturnValue({
        sort: () => ({
          skip: () => ({ limit: () => ({ toArray: async () => [] }) }),
        }),
      });
    const collection = jest.fn((name: string) =>
      name === 'users'
        ? { findOne: async () => ({ _id: userId, status: 'active' }) }
        : { countDocuments: async () => 0, find },
    );
    const bridge = new TeamBridge({ connection: { collection } } as never);
    await bridge.publicItineraries(userId.toString(), 1);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.objectContaining({
            ownerId: userId,
            visibility: 'public',
            isHidden: { $ne: true },
          }),
        ]),
      }),
      expect.anything(),
    );
  });

  it('feeds itinerary stays from Member 3 hotel availability search', async () => {
    const search = jest
      .fn()
      .mockResolvedValue({
        items: [
          {
            id: 'hotel-1',
            name: 'Stay',
            pricePerNightCents: 12000,
            selectedRooms: [],
          },
        ],
      });
    const port = new TeamHotelSearchPort({ search } as never);
    const result = await port.search({
      cityId: 'city-1',
      cityName: 'Cairo',
      checkIn: '2026-12-01',
      checkOut: '2026-12-03',
      guests: 2,
      rooms: 1,
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Cairo',
        checkIn: '2026-12-01',
        checkOut: '2026-12-03',
        guests: 2,
        rooms: 1,
      }),
    );
    expect(result.hotels[0]).toMatchObject({
      id: 'hotel-1',
      pricePerNightCents: 12000,
    });
  });
});
