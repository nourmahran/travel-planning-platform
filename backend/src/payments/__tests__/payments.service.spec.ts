import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus, BookingType } from '../../common/booking';
import { BookingGatewayRegistry } from '../gateway/booking-gateway.registry';
import { PaymentsService } from '../payments.service';
import { PaymentStatus } from '../schemas/payment.schema';
import { FakeBookingGateway } from './fake-booking.gateway';
import { FakeModel } from './fake-model';
import { asModel, FakeStripe, makeModels, testConfig } from './test-helpers';

const oid = () => new Types.ObjectId().toString();

describe('PAY-01 PaymentsService', () => {
  let flights: FakeBookingGateway;
  let stripe: FakeStripe;
  let payments: FakeModel;
  let service: PaymentsService;
  const user = { id: oid(), role: 'USER' };
  const stranger = { id: oid(), role: 'USER' };
  const admin = { id: oid(), role: 'ADMIN' };

  /** A payable booking: PendingPayment, active hold, policies accepted. */
  function payableBooking(overrides = {}) {
    const b = flights.seed({ id: oid(), userId: user.id, ...overrides });
    if (!('policiesAcceptedAt' in overrides)) flights.acceptPolicies(b.id);
    return b;
  }
  const create = (bookingId: string, who = user) =>
    service.createPayment(who, { bookingType: BookingType.Flight, bookingId });

  beforeEach(() => {
    const registry = new BookingGatewayRegistry();
    flights = new FakeBookingGateway(BookingType.Flight);
    registry.register(flights);
    stripe = new FakeStripe();
    ({ payments } = makeModels());
    service = new PaymentsService(
      asModel(payments),
      registry,
      stripe.asService(),
      testConfig(),
    );
  });

  describe('createPayment — checks in order', () => {
    it('1: 404 when the booking does not exist', async () => {
      await expect(create(oid())).rejects.toThrow(
        new NotFoundException('Booking not found'),
      );
    });

    it('1: 404 when the booking belongs to someone else', async () => {
      const b = payableBooking();
      await expect(create(b.id, stranger)).rejects.toThrow(NotFoundException);
    });

    it('2: 409 when the booking is not PendingPayment', async () => {
      const b = payableBooking({ status: BookingStatus.Confirmed });
      await expect(create(b.id)).rejects.toThrow(
        new ConflictException('Booking is not awaiting payment'),
      );
    });

    it('3: 410 when the hold has expired', async () => {
      const b = payableBooking();
      flights.setHoldExpired(b.id);
      await expect(create(b.id)).rejects.toThrow(
        new GoneException('Booking hold has expired'),
      );
    });

    it('4: 400 when policies were not accepted', async () => {
      const b = payableBooking({ policiesAcceptedAt: null });
      await expect(create(b.id)).rejects.toThrow(
        new BadRequestException('Policies must be accepted before payment'),
      );
    });

    it('5: 400 when the booking currency is not the platform currency', async () => {
      const b = payableBooking({ currency: 'eur' });
      await expect(create(b.id)).rejects.toThrow(
        new BadRequestException('Unsupported currency'),
      );
    });

    it('6: 409 when the booking was already paid', async () => {
      const b = payableBooking();
      await payments.create({
        bookingType: 'flight',
        bookingId: new Types.ObjectId(b.id),
        userId: new Types.ObjectId(user.id),
        stripePaymentIntentId: 'pi_old',
        amount: 25050,
        currency: 'usd',
        status: PaymentStatus.Succeeded,
      });
      await expect(create(b.id)).rejects.toThrow(
        new ConflictException('Booking already paid'),
      );
    });

    it('7: 400 when the amount is not positive', async () => {
      const b = payableBooking({ totalAmount: 0 });
      await expect(create(b.id)).rejects.toThrow(BadRequestException);
    });

    it('503 when the booking type is not wired yet', async () => {
      await expect(
        service.createPayment(user, {
          bookingType: BookingType.Hotel,
          bookingId: oid(),
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('createPayment — success', () => {
    it('charges the amount from the booking and never stores the client secret', async () => {
      const b = payableBooking({ totalAmount: 250.5 });
      const res = await create(b.id);

      expect(stripe.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amountMinor: 25050,
          currency: 'usd',
          idempotencyKey: `pi:flight:${b.id}:1`,
          metadata: expect.objectContaining({
            bookingType: 'flight',
            bookingId: b.id,
            userId: user.id,
          }),
        }),
      );
      expect(res).toMatchObject({
        clientSecret: 'pi_1_secret_test',
        amount: 250.5,
        currency: 'usd',
        status: PaymentStatus.Pending,
        holdExpiresAt: b.holdExpiresAt,
      });
      expect(payments.docs).toHaveLength(1);
      const stored = payments.docs[0];
      expect(stored).toMatchObject({
        amount: 25050,
        status: PaymentStatus.Pending,
        stripePaymentIntentId: 'pi_1',
      });
      expect(JSON.stringify(stored)).not.toContain('secret');
    });

    it('reuses an open PaymentIntent instead of creating a second one', async () => {
      const b = payableBooking();
      const first = await create(b.id);
      const second = await create(b.id);
      expect(second.paymentId).toBe(first.paymentId);
      expect(second.clientSecret).toBe(first.clientSecret);
      expect(stripe.createCalls).toBe(1);
      expect(payments.docs).toHaveLength(1);
    });

    it('two concurrent requests end up with one PaymentIntent and one record', async () => {
      const b = payableBooking();
      const [a, c] = await Promise.all([create(b.id), create(b.id)]);
      expect(a.paymentId).toBe(c.paymentId);
      expect(stripe.pis.size).toBe(1);
      expect(payments.docs).toHaveLength(1);
    });

    it('replaces a PaymentIntent that was cancelled in Stripe', async () => {
      const b = payableBooking();
      const first = await create(b.id);
      stripe.setStatus('pi_1', 'canceled');
      const second = await create(b.id);
      expect(second.paymentId).not.toBe(first.paymentId);
      expect(payments.get(first.paymentId)?.status).toBe(
        PaymentStatus.Cancelled,
      );
      expect(stripe.createPaymentIntent).toHaveBeenLastCalledWith(
        expect.objectContaining({ idempotencyKey: `pi:flight:${b.id}:2` }),
      );
    });

    it('409 when the open PaymentIntent is already processing', async () => {
      const b = payableBooking();
      await create(b.id);
      stripe.setStatus('pi_1', 'processing');
      await expect(create(b.id)).rejects.toThrow(
        'A payment for this booking is already being processed',
      );
    });
  });

  describe('retryPayment', () => {
    async function failedPayment() {
      const b = payableBooking();
      const res = await create(b.id);
      payments.get(res.paymentId)!.status = PaymentStatus.Failed;
      payments.get(res.paymentId)!.failureMessage = 'Your card was declined.';
      return { b, res };
    }

    it('reuses the PaymentIntent when Stripe allows it (requires_payment_method)', async () => {
      const { res } = await failedPayment();
      const retry = await service.retryPayment(user, res.paymentId);
      expect(retry.paymentId).toBe(res.paymentId);
      expect(retry.clientSecret).toBe(res.clientSecret);
      const doc = payments.get(res.paymentId)!;
      expect(doc).toMatchObject({ status: PaymentStatus.Pending, attempts: 2 });
      expect(doc.failureMessage).toBeUndefined();
      expect(stripe.createCalls).toBe(1);
    });

    it('creates a new PaymentIntent when the old one cannot be reused', async () => {
      const { res } = await failedPayment();
      stripe.setStatus('pi_1', 'canceled');
      const retry = await service.retryPayment(user, res.paymentId);
      expect(retry.paymentId).not.toBe(res.paymentId);
      expect(payments.get(res.paymentId)?.status).toBe(PaymentStatus.Cancelled);
      expect(payments.docs).toHaveLength(2);
    });

    it('re-checks the booking: 410 once the hold expired', async () => {
      const { b, res } = await failedPayment();
      flights.setHoldExpired(b.id);
      await expect(service.retryPayment(user, res.paymentId)).rejects.toThrow(
        GoneException,
      );
    });

    it('404 for another user', async () => {
      const { res } = await failedPayment();
      await expect(
        service.retryPayment(stranger, res.paymentId),
      ).rejects.toThrow(NotFoundException);
    });

    it('409 for a succeeded payment', async () => {
      const { res } = await failedPayment();
      payments.get(res.paymentId)!.status = PaymentStatus.Succeeded;
      await expect(service.retryPayment(user, res.paymentId)).rejects.toThrow(
        new ConflictException('Booking already paid'),
      );
    });

    it('409 for a Pending payment that is not waiting for a new card', async () => {
      const b = payableBooking();
      const res = await create(b.id);
      stripe.setStatus('pi_1', 'requires_action');
      await expect(service.retryPayment(user, res.paymentId)).rejects.toThrow(
        new ConflictException('Payment is not retryable'),
      );
    });
  });

  describe('getPayment', () => {
    it('returns the payment to its owner with the amount in major units', async () => {
      const b = payableBooking({ totalAmount: 99.99 });
      const res = await create(b.id);
      const got = await service.getPayment(user, res.paymentId);
      expect(got).toMatchObject({
        id: res.paymentId,
        bookingType: 'flight',
        bookingId: b.id,
        amount: 99.99,
        currency: 'usd',
        status: PaymentStatus.Pending,
        failureMessage: null,
        attempts: 1,
      });
    });

    it('allows admins, hides it from other users', async () => {
      const b = payableBooking();
      const res = await create(b.id);
      await expect(
        service.getPayment(admin, res.paymentId),
      ).resolves.toBeDefined();
      await expect(service.getPayment(stranger, res.paymentId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancelForExpiredBooking', () => {
    it('cancels open PaymentIntents and is safe to call twice', async () => {
      const b = payableBooking();
      const res = await create(b.id);
      expect(
        await service.cancelForExpiredBooking(BookingType.Flight, b.id),
      ).toEqual({
        cancelled: 1,
      });
      expect(stripe.pis.get('pi_1')?.status).toBe('canceled');
      expect(payments.get(res.paymentId)?.status).toBe(PaymentStatus.Cancelled);

      expect(
        await service.cancelForExpiredBooking(BookingType.Flight, b.id),
      ).toEqual({
        cancelled: 0,
      });
    });

    it('leaves a PaymentIntent that succeeded at the last second (webhook refunds it)', async () => {
      const b = payableBooking();
      const res = await create(b.id);
      stripe.setStatus('pi_1', 'succeeded');
      expect(
        await service.cancelForExpiredBooking(BookingType.Flight, b.id),
      ).toEqual({
        cancelled: 0,
      });
      expect(payments.get(res.paymentId)?.status).toBe(PaymentStatus.Pending);
    });

    it('does not throw when Stripe is down (next run retries)', async () => {
      const b = payableBooking();
      await create(b.id);
      stripe.cancelPaymentIntent.mockRejectedValueOnce(new Error('down'));
      await expect(
        service.cancelForExpiredBooking(BookingType.Flight, b.id),
      ).resolves.toEqual({ cancelled: 0 });
    });
  });

  describe('devConfirm', () => {
    it('confirms with a test token but does NOT confirm the booking itself', async () => {
      const b = payableBooking();
      const res = await create(b.id);
      const out = await service.devConfirm(user, res.paymentId, 'pm_card_visa');
      expect(out.paymentIntentStatus).toBe('succeeded');
      expect(flights.bookings.get(b.id)?.status).toBe(
        BookingStatus.PendingPayment,
      );
      expect(flights.confirmCalls).toBe(0);
    });

    it('only the owner can use it, and only on Pending payments', async () => {
      const b = payableBooking();
      const res = await create(b.id);
      await expect(
        service.devConfirm(stranger, res.paymentId, 'pm_card_visa'),
      ).rejects.toThrow(NotFoundException);
      payments.get(res.paymentId)!.status = PaymentStatus.Failed;
      await expect(
        service.devConfirm(user, res.paymentId, 'pm_card_visa'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
