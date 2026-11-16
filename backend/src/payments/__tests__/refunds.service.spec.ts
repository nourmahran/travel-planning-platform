import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import type Stripe from 'stripe';
import { BookingStatus, BookingType } from '../../common/booking';
import { PaymentEvents } from '../events';
import { BookingGatewayRegistry } from '../gateway/booking-gateway.registry';
import type { NotificationPort } from '../gateway/notification.port';
import { mapStripeRefundStatus, RefundsService } from '../refunds.service';
import { PaymentStatus } from '../schemas/payment.schema';
import { RefundReason, RefundStatus } from '../schemas/refund.schema';
import { FakeBookingGateway } from './fake-booking.gateway';
import type { FakeModel } from './fake-model';
import {
  asModel,
  FakeStripe,
  fakeEmitter,
  fakeNotifier,
  makeModels,
  testConfig,
} from './test-helpers';

const DAY = 86_400_000;
const oid = () => new Types.ObjectId().toString();

describe('PAY-03 RefundsService', () => {
  let flights: FakeBookingGateway;
  let hotels: FakeBookingGateway;
  let stripe: FakeStripe;
  let payments: FakeModel;
  let refunds: FakeModel;
  let emitter: ReturnType<typeof fakeEmitter>;
  let notifier: ReturnType<typeof fakeNotifier>;
  let service: RefundsService;
  const user = { id: oid(), role: 'user' };
  const now = new Date('2026-11-08T12:00:00Z');

  /** A paid booking: Confirmed, policies accepted, one Succeeded payment. */
  async function paidBooking(
    gw: FakeBookingGateway,
    opts: { startsInDays?: number; amountMinor?: number; startsAt?: Date } = {},
  ) {
    const b = gw.seed({
      id: oid(),
      userId: user.id,
      status: BookingStatus.Confirmed,
      startsAt:
        opts.startsAt ??
        new Date(now.getTime() + (opts.startsInDays ?? 40) * DAY),
    });
    gw.acceptPolicies(b.id, now);
    const payment = await payments.create({
      bookingType: gw.type,
      bookingId: new Types.ObjectId(b.id),
      userId: new Types.ObjectId(user.id),
      stripePaymentIntentId: `pi_${b.id}`,
      amount: opts.amountMinor ?? 20000,
      currency: 'usd',
      status: PaymentStatus.Succeeded,
    });
    return { b, payment };
  }

  beforeEach(() => {
    const registry = new BookingGatewayRegistry();
    flights = new FakeBookingGateway(BookingType.Flight);
    hotels = new FakeBookingGateway(BookingType.Hotel);
    registry.register(flights);
    registry.register(hotels);
    stripe = new FakeStripe();
    ({ payments, refunds } = makeModels());
    emitter = fakeEmitter();
    notifier = fakeNotifier();
    service = new RefundsService(
      asModel(refunds),
      asModel(payments),
      registry,
      stripe.asService(),
      notifier as unknown as NotificationPort,
      emitter as unknown as EventEmitter2,
      testConfig(),
    );
  });

  describe('issueRefund', () => {
    it('refunds by tier on a user cancellation and records it', async () => {
      const { b, payment } = await paidBooking(flights, { startsInDays: 10 });
      flights.setStatus(b.id, BookingStatus.Cancelled);

      const r = await service.issueRefund(
        BookingType.Flight,
        b.id,
        RefundReason.UserCancellation,
        now,
      );

      expect(r).toMatchObject({
        amount: 10000, // 50% tier (7 <= 10 < 30)
        percent: 50,
        status: RefundStatus.Refunded,
        reason: RefundReason.UserCancellation,
        stripeRefundId: 're_1',
      });
      expect(stripe.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentIntentId: payment.stripePaymentIntentId,
          amountMinor: 10000,
          idempotencyKey: `refund:flight:${b.id}`,
        }),
      );
      expect(notifier.notify).toHaveBeenCalledWith(
        user.id,
        'REFUND_ISSUED',
        expect.stringContaining('100.00 USD'),
        expect.any(Object),
      );
      expect(emitter.emit).toHaveBeenCalledWith(
        PaymentEvents.RefundCreated,
        expect.objectContaining({
          bookingId: b.id,
          amount: 10000,
          percent: 50,
        }),
      );
    });

    it('returns null for a 0% refund: no Stripe call, no record', async () => {
      const { b } = await paidBooking(flights, { startsInDays: 3 });
      flights.setStatus(b.id, BookingStatus.Cancelled);
      const r = await service.issueRefund(
        BookingType.Flight,
        b.id,
        RefundReason.UserCancellation,
        now,
      );
      expect(r).toBeNull();
      expect(stripe.createRefund).not.toHaveBeenCalled();
      expect(refunds.docs).toHaveLength(0);
    });

    it('is idempotent: the second call returns the same refund', async () => {
      const { b } = await paidBooking(flights);
      flights.setStatus(b.id, BookingStatus.Cancelled);
      const first = await service.issueRefund(
        BookingType.Flight,
        b.id,
        RefundReason.UserCancellation,
        now,
      );
      const second = await service.issueRefund(
        BookingType.Flight,
        b.id,
        RefundReason.UserCancellation,
        now,
      );
      expect(String(second?._id)).toBe(String(first?._id));
      expect(stripe.createRefund).toHaveBeenCalledTimes(1);
      expect(refunds.docs).toHaveLength(1);
    });

    it('records Failed and does NOT throw when Stripe fails', async () => {
      const { b } = await paidBooking(flights);
      flights.setStatus(b.id, BookingStatus.Cancelled);
      stripe.failRefunds = true;

      const r = await service.issueRefund(
        BookingType.Flight,
        b.id,
        RefundReason.UserCancellation,
        now,
      );

      expect(r).toMatchObject({
        status: RefundStatus.Failed,
        failureMessage: 'Refund could not be processed by the payment provider',
      });
      expect(notifier.notify).toHaveBeenCalledWith(
        user.id,
        'REFUND_FAILED',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('provider cancellation (FLT-06) refunds 100% even inside the 0% tier', async () => {
      const { b } = await paidBooking(flights, { startsInDays: 1 });
      flights.setStatus(b.id, BookingStatus.Cancelled);
      const r = await service.issueRefund(
        BookingType.Flight,
        b.id,
        RefundReason.ProviderCancellation,
        now,
      );
      expect(r).toMatchObject({ percent: 100, amount: 20000 });
    });

    it('round trip (FLT-12a): uses the outbound departure passed as startsAt', async () => {
      // Outbound in 8 days (50% tier). The return leg 30+ days later does not matter.
      const { b } = await paidBooking(flights, { startsInDays: 8 });
      flights.setStatus(b.id, BookingStatus.Cancelled);
      const r = await service.issueRefund(
        BookingType.Flight,
        b.id,
        RefundReason.UserCancellation,
        now,
      );
      expect(r?.percent).toBe(50);
    });

    it('hotel (HTL-21): refund on the full total, by calendar days to check-in', async () => {
      const { b } = await paidBooking(hotels, {
        startsAt: new Date('2026-11-22T00:00:00Z'), // 14 calendar days → 100%
        amountMinor: 33333,
      });
      hotels.setStatus(b.id, BookingStatus.Cancelled);
      const r = await service.issueRefund(
        BookingType.Hotel,
        b.id,
        RefundReason.UserCancellation,
        now,
      );
      expect(r).toMatchObject({ percent: 100, amount: 33333 });
    });

    it('uses the accepted policy snapshot, not tiers edited later', async () => {
      const { b } = await paidBooking(flights, { startsInDays: 10 });
      flights.policies = {
        ...flights.policies,
        cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
      };
      flights.setStatus(b.id, BookingStatus.Cancelled);
      const r = await service.issueRefund(
        BookingType.Flight,
        b.id,
        RefundReason.UserCancellation,
        now,
      );
      expect(r?.percent).toBe(50);
    });

    it('409 when the booking has not been cancelled yet', async () => {
      const { b } = await paidBooking(flights);
      await expect(
        service.issueRefund(
          BookingType.Flight,
          b.id,
          RefundReason.UserCancellation,
          now,
        ),
      ).rejects.toThrow('Booking must be cancelled before it can be refunded');
    });

    it('409 when there is no successful payment', async () => {
      const b = flights.seed({
        id: oid(),
        userId: user.id,
        status: BookingStatus.Cancelled,
      });
      await expect(
        service.issueRefund(
          BookingType.Flight,
          b.id,
          RefundReason.UserCancellation,
          now,
        ),
      ).rejects.toThrow(new ConflictException('No successful payment found'));
    });

    it('a notification failure does not break the refund', async () => {
      const { b } = await paidBooking(flights);
      flights.setStatus(b.id, BookingStatus.Cancelled);
      notifier.notify.mockRejectedValueOnce(new Error('down'));
      await expect(
        service.issueRefund(
          BookingType.Flight,
          b.id,
          RefundReason.UserCancellation,
          now,
        ),
      ).resolves.toMatchObject({ status: RefundStatus.Refunded });
    });
  });

  describe('previewRefund', () => {
    it('shows the amount without side effects', async () => {
      const { b } = await paidBooking(flights, { startsInDays: 10 });
      const p = await service.previewRefund(
        BookingType.Flight,
        b.id,
        user.id,
        undefined,
        now,
      );
      expect(p).toEqual({
        percent: 50,
        amount: 100,
        currency: 'usd',
        daysRemaining: 10,
        cancellable: true,
      });
      expect(refunds.docs).toHaveLength(0);
      expect(stripe.createRefund).not.toHaveBeenCalled();
    });

    it('not cancellable after departure (FLT-26)', async () => {
      const { b } = await paidBooking(flights, {
        startsAt: new Date(now.getTime() - 60_000),
      });
      const p = await service.previewRefund(
        BookingType.Flight,
        b.id,
        user.id,
        undefined,
        now,
      );
      expect(p).toMatchObject({
        cancellable: false,
        amount: 0,
        message: 'The flight has already departed',
      });
    });

    it('not cancellable on/after the check-in date (HTL-21)', async () => {
      const { b } = await paidBooking(hotels, {
        startsAt: new Date('2026-11-08T00:00:00Z'),
      });
      const p = await service.previewRefund(
        BookingType.Hotel,
        b.id,
        user.id,
        undefined,
        now,
      );
      expect(p.cancellable).toBe(false);
    });

    it('404 for another user, 409 for a non-confirmed booking', async () => {
      const { b } = await paidBooking(flights);
      await expect(
        service.previewRefund(BookingType.Flight, b.id, oid(), undefined, now),
      ).rejects.toThrow(NotFoundException);
      flights.setStatus(b.id, BookingStatus.Cancelled);
      await expect(
        service.previewRefund(
          BookingType.Flight,
          b.id,
          user.id,
          undefined,
          now,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('syncFromStripe (refund webhooks)', () => {
    async function pendingRefund() {
      stripe.refundStatus = 'pending';
      const { b } = await paidBooking(flights);
      flights.setStatus(b.id, BookingStatus.Cancelled);
      const r = await service.issueRefund(
        BookingType.Flight,
        b.id,
        RefundReason.UserCancellation,
        now,
      );
      expect(r?.status).toBe(RefundStatus.Pending);
      return r!;
    }
    const stripeRefund = (id: string, status: string, metadata = {}) =>
      ({ id, status, metadata }) as unknown as Stripe.Refund;

    it('pending -> Refunded emits refund.status_changed', async () => {
      const r = await pendingRefund();
      const out = await service.syncFromStripe(
        stripeRefund(r.stripeRefundId!, 'succeeded'),
      );
      expect(out?.status).toBe(RefundStatus.Refunded);
      expect(emitter.emit).toHaveBeenCalledWith(
        PaymentEvents.RefundStatusChanged,
        expect.objectContaining({
          previousStatus: RefundStatus.Pending,
          status: RefundStatus.Refunded,
        }),
      );
    });

    it('failed -> Failed and notifies the user', async () => {
      const r = await pendingRefund();
      const out = await service.syncFromStripe(
        stripeRefund(r.stripeRefundId!, 'failed'),
      );
      expect(out?.status).toBe(RefundStatus.Failed);
      expect(notifier.notify).toHaveBeenLastCalledWith(
        user.id,
        'REFUND_FAILED',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('never moves a final status back to Pending', async () => {
      const r = await pendingRefund();
      await service.syncFromStripe(
        stripeRefund(r.stripeRefundId!, 'succeeded'),
      );
      const out = await service.syncFromStripe(
        stripeRefund(r.stripeRefundId!, 'pending'),
      );
      expect(out?.status).toBe(RefundStatus.Refunded);
    });

    it('finds the record through metadata.refundId when the id is not saved yet', async () => {
      const r = await pendingRefund();
      refunds.get(r._id)!.stripeRefundId = undefined;
      const out = await service.syncFromStripe(
        stripeRefund('re_new', 'succeeded', { refundId: String(r._id) }),
      );
      expect(out).toMatchObject({
        status: RefundStatus.Refunded,
        stripeRefundId: 're_new',
      });
    });

    it('ignores unknown refunds', async () => {
      await expect(
        service.syncFromStripe(stripeRefund('re_x', 'succeeded')),
      ).resolves.toBeNull();
    });
  });

  it('maps Stripe refund statuses', () => {
    expect(mapStripeRefundStatus('succeeded')).toBe(RefundStatus.Refunded);
    expect(mapStripeRefundStatus('pending')).toBe(RefundStatus.Pending);
    expect(mapStripeRefundStatus('requires_action')).toBe(RefundStatus.Pending);
    expect(mapStripeRefundStatus('failed')).toBe(RefundStatus.Failed);
    expect(mapStripeRefundStatus('canceled')).toBe(RefundStatus.Failed);
    expect(mapStripeRefundStatus(null)).toBe(RefundStatus.Pending);
  });

  it('getRefund: owner and admin only', async () => {
    const { b } = await paidBooking(flights);
    flights.setStatus(b.id, BookingStatus.Cancelled);
    const r = await service.issueRefund(
      BookingType.Flight,
      b.id,
      RefundReason.UserCancellation,
      now,
    );
    const id = String(r!._id);
    await expect(service.getRefund(user, id)).resolves.toMatchObject({
      id,
      amount: 200,
      percent: 100,
      status: RefundStatus.Refunded,
    });
    await expect(
      service.getRefund({ id: oid(), role: 'admin' }, id),
    ).resolves.toBeDefined();
    await expect(
      service.getRefund({ id: oid(), role: 'user' }, id),
    ).rejects.toThrow(NotFoundException);
  });
});
