import {
  BadRequestException,
  InternalServerErrorException,
  type INestApplication,
} from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import Stripe from 'stripe';
import request from 'supertest';
import { BookingStatus, BookingType } from '../../common/booking';
import { PaymentEvents } from '../events';
import { BookingGatewayRegistry } from '../gateway/booking-gateway.registry';
import type { NotificationPort } from '../gateway/notification.port';
import { RefundsService } from '../refunds.service';
import { PaymentStatus } from '../schemas/payment.schema';
import { RefundReason, RefundStatus } from '../schemas/refund.schema';
import { StripeService } from '../stripe/stripe.service';
import { WebhookController } from '../webhook.controller';
import { WebhookService } from '../webhook.service';
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
import { applyApiPrefix } from '../../common/http/api-prefix';

const oid = () => new Types.ObjectId().toString();
let eventSeq = 0;

function stripeEvent(
  type: string,
  object: Record<string, unknown>,
): Stripe.Event {
  return {
    id: `evt_${++eventSeq}`,
    object: 'event',
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

describe('PAY-01 Stripe webhook', () => {
  let flights: FakeBookingGateway;
  let stripe: FakeStripe;
  let payments: FakeModel;
  let refunds: FakeModel;
  let events: FakeModel;
  let emitter: ReturnType<typeof fakeEmitter>;
  let notifier: ReturnType<typeof fakeNotifier>;
  let refundsService: RefundsService;
  let service: WebhookService;
  const userId = oid();

  /** PendingPayment booking with a Pending payment on PaymentIntent pi_<n>. */
  async function pendingPayment() {
    const b = flights.seed({ id: oid(), userId });
    flights.acceptPolicies(b.id);
    const piId = `pi_${b.id}`;
    const p = await payments.create({
      bookingType: BookingType.Flight,
      bookingId: new Types.ObjectId(b.id),
      userId: new Types.ObjectId(userId),
      stripePaymentIntentId: piId,
      amount: 25050,
      currency: 'usd',
      status: PaymentStatus.Pending,
      attempts: 1,
    });
    return { b, p, pi: { id: piId, amount: 25050, currency: 'usd' } };
  }

  beforeEach(() => {
    const registry = new BookingGatewayRegistry();
    flights = new FakeBookingGateway(BookingType.Flight);
    registry.register(flights);
    stripe = new FakeStripe();
    ({ payments, refunds, events } = makeModels());
    emitter = fakeEmitter();
    notifier = fakeNotifier();
    refundsService = new RefundsService(
      asModel(refunds),
      asModel(payments),
      registry,
      stripe.asService(),
      notifier as unknown as NotificationPort,
      emitter as unknown as EventEmitter2,
      testConfig(),
    );
    service = new WebhookService(
      asModel(events),
      asModel(payments),
      registry,
      refundsService,
      stripe.asService(),
      notifier as unknown as NotificationPort,
      emitter as unknown as EventEmitter2,
    );
  });

  describe('signature', () => {
    it('400 when the signature header or body is missing', () => {
      expect(() => service.verify(undefined, 'sig')).toThrow(
        new BadRequestException('Missing Stripe signature'),
      );
      expect(() => service.verify(Buffer.from('{}'), undefined)).toThrow(
        BadRequestException,
      );
    });

    it('400 Invalid signature when Stripe rejects it', () => {
      stripe.constructWebhookEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });
      expect(() => service.verify(Buffer.from('{}'), 't=1,v1=bad')).toThrow(
        new BadRequestException('Invalid signature'),
      );
    });
  });

  describe('duplicate protection', () => {
    it('processes the same event only once', async () => {
      const { b, pi } = await pendingPayment();
      const evt = stripeEvent('payment_intent.succeeded', pi);
      await expect(service.process(evt)).resolves.toEqual({ received: true });
      await expect(service.process(evt)).resolves.toEqual({ received: true });
      expect(flights.confirmCalls).toBe(1);
      expect(events.docs).toHaveLength(1);
      expect(flights.bookings.get(b.id)?.status).toBe(BookingStatus.Confirmed);
    });

    it('if the handler fails, forgets the event and returns 500 so Stripe retries', async () => {
      const { b, pi } = await pendingPayment();
      const confirm = jest
        .spyOn(flights, 'confirm')
        .mockRejectedValueOnce(new Error('db down'));
      const evt = stripeEvent('payment_intent.succeeded', pi);

      await expect(service.process(evt)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(events.docs).toHaveLength(0);

      // Stripe retries: payment is already Succeeded but the booking must still be confirmed.
      confirm.mockRestore();
      await service.process(evt);
      expect(flights.bookings.get(b.id)?.status).toBe(BookingStatus.Confirmed);
    });

    it('acknowledges unhandled event types with 200', async () => {
      await expect(
        service.process(stripeEvent('customer.created', { id: 'cus_1' })),
      ).resolves.toEqual({ received: true });
    });
  });

  describe('payment_intent.succeeded', () => {
    it('marks the payment Succeeded, confirms the booking and emits payment.succeeded', async () => {
      const { b, p, pi } = await pendingPayment();
      await service.process(stripeEvent('payment_intent.succeeded', pi));

      expect(payments.get(p._id)).toMatchObject({
        status: PaymentStatus.Succeeded,
      });
      expect(payments.get(p._id)?.succeededAt).toBeInstanceOf(Date);
      expect(flights.bookings.get(b.id)?.status).toBe(BookingStatus.Confirmed);
      expect(emitter.emit).toHaveBeenCalledWith(
        PaymentEvents.Succeeded,
        expect.objectContaining({
          bookingType: 'flight',
          bookingId: b.id,
          userId,
          paymentId: String(p._id),
          amount: 25050,
        }),
      );
    });

    it('LATE PAYMENT: booking already Expired → refund 100% and emit payment.late_refunded', async () => {
      const { b, pi } = await pendingPayment();
      flights.setStatus(b.id, BookingStatus.Expired);

      await service.process(stripeEvent('payment_intent.succeeded', pi));

      expect(flights.bookings.get(b.id)?.status).toBe(BookingStatus.Expired);
      expect(refunds.docs).toHaveLength(1);
      expect(refunds.docs[0]).toMatchObject({
        reason: RefundReason.LatePayment,
        percent: 100,
        amount: 25050,
        status: RefundStatus.Refunded,
      });
      expect(emitter.emit).toHaveBeenCalledWith(
        PaymentEvents.LateRefunded,
        expect.objectContaining({
          bookingId: b.id,
          status: RefundStatus.Refunded,
        }),
      );
      expect(emitter.emit).not.toHaveBeenCalledWith(
        PaymentEvents.Succeeded,
        expect.anything(),
      );
    });

    it('a redelivered success for an already-confirmed booking does nothing', async () => {
      const { b, pi } = await pendingPayment();
      await service.process(stripeEvent('payment_intent.succeeded', pi));
      // Different event id, same PaymentIntent (e.g. resent from the dashboard)
      await service.process(stripeEvent('payment_intent.succeeded', pi));
      expect(flights.bookings.get(b.id)?.status).toBe(BookingStatus.Confirmed);
      expect(refunds.docs).toHaveLength(0);
    });

    it('ignores an unknown PaymentIntent (e.g. `stripe trigger`) with 200', async () => {
      await expect(
        service.process(
          stripeEvent('payment_intent.succeeded', { id: 'pi_unknown' }),
        ),
      ).resolves.toEqual({ received: true });
      expect(flights.confirmCalls).toBe(0);
    });

    it('refunds a duplicate charge when the booking was already paid by another PaymentIntent', async () => {
      const { b, pi } = await pendingPayment();
      await service.process(stripeEvent('payment_intent.succeeded', pi));
      const dup = await payments.create({
        bookingType: BookingType.Flight,
        bookingId: new Types.ObjectId(b.id),
        userId: new Types.ObjectId(userId),
        stripePaymentIntentId: 'pi_dup',
        amount: 25050,
        currency: 'usd',
        status: PaymentStatus.Pending,
      });

      await service.process(
        stripeEvent('payment_intent.succeeded', {
          id: 'pi_dup',
          amount: 25050,
        }),
      );

      expect(stripe.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentIntentId: 'pi_dup',
          amountMinor: 25050,
        }),
      );
      expect(payments.get(dup._id)).toMatchObject({
        status: PaymentStatus.Cancelled,
        duplicateRefundId: expect.stringMatching(/^re_/),
      });
    });
  });

  describe('payment_intent.payment_failed', () => {
    it('sets Failed with a short message; booking stays PendingPayment', async () => {
      const { b, p, pi } = await pendingPayment();
      await service.process(
        stripeEvent('payment_intent.payment_failed', {
          ...pi,
          last_payment_error: { message: 'Your card was declined.' },
        }),
      );
      expect(payments.get(p._id)).toMatchObject({
        status: PaymentStatus.Failed,
        failureMessage: 'Your card was declined.',
      });
      expect(flights.bookings.get(b.id)?.status).toBe(
        BookingStatus.PendingPayment,
      );
      expect(emitter.emit).toHaveBeenCalledWith(
        PaymentEvents.Failed,
        expect.objectContaining({ failureMessage: 'Your card was declined.' }),
      );
      expect(notifier.notify).toHaveBeenCalledWith(
        userId,
        'PAYMENT_FAILED',
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('payment_intent.canceled', () => {
    it('sets Cancelled but never overwrites Succeeded', async () => {
      const first = await pendingPayment();
      await service.process(stripeEvent('payment_intent.canceled', first.pi));
      expect(payments.get(first.p._id)?.status).toBe(PaymentStatus.Cancelled);

      const second = await pendingPayment();
      await service.process(stripeEvent('payment_intent.succeeded', second.pi));
      await service.process(stripeEvent('payment_intent.canceled', second.pi));
      expect(payments.get(second.p._id)?.status).toBe(PaymentStatus.Succeeded);
    });
  });

  describe('refund events', () => {
    it.each([
      ['refund.updated', 'succeeded', RefundStatus.Refunded],
      ['refund.failed', 'failed', RefundStatus.Failed],
      ['charge.refund.updated', 'canceled', RefundStatus.Failed],
    ])('%s with status %s → %s', async (type, stripeStatus, expected) => {
      stripe.refundStatus = 'pending';
      const { b, pi } = await pendingPayment();
      await service.process(stripeEvent('payment_intent.succeeded', pi));
      flights.setStatus(b.id, BookingStatus.Cancelled);
      const refund = await refundsService.issueRefund(
        BookingType.Flight,
        b.id,
        RefundReason.ProviderCancellation,
      );
      expect(refund?.status).toBe(RefundStatus.Pending);

      await service.process(
        stripeEvent(type, {
          id: refund!.stripeRefundId,
          status: stripeStatus,
          metadata: {},
        }),
      );
      expect(refunds.get(refund!._id)?.status).toBe(expected);
    });
  });

  describe('HTTP endpoint with raw body (real signature algorithm)', () => {
    const secret = 'whsec_test_dummy_for_unit_tests';
    let app: INestApplication;
    const real = new Stripe('sk_test_dummy');

    beforeAll(async () => {
      const realStripeService = new StripeService(
        real,
        testConfig({ STRIPE_WEBHOOK_SECRET: secret }),
      );
      const webhookService = {
        verify: (raw: Buffer | undefined, sig: string | undefined) => {
          if (!raw || !sig)
            throw new BadRequestException('Missing Stripe signature');
          try {
            return realStripeService.constructWebhookEvent(raw, sig);
          } catch {
            throw new BadRequestException('Invalid signature');
          }
        },
        process: jest.fn().mockResolvedValue({ received: true }),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [WebhookController],
        providers: [{ provide: WebhookService, useValue: webhookService }],
      }).compile();
      app = moduleRef.createNestApplication({ rawBody: true });
      applyApiPrefix(app);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('accepts a correctly signed payload (200)', async () => {
      const payload = JSON.stringify({
        id: 'evt_http',
        object: 'event',
        type: 'ping',
        data: { object: {} },
      });
      const header = real.webhooks.generateTestHeaderString({
        payload,
        secret,
      });
      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .set('content-type', 'application/json')
        .set('stripe-signature', header)
        .send(payload)
        .expect(200, { received: true });
    });

    it('rejects an unsigned request (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .set('content-type', 'application/json')
        .send({ id: 'evt_fake', type: 'payment_intent.succeeded' })
        .expect(400);
    });

    it('rejects a tampered body (400)', async () => {
      const payload = JSON.stringify({
        id: 'evt_http2',
        object: 'event',
        type: 'ping',
      });
      const header = real.webhooks.generateTestHeaderString({
        payload,
        secret,
      });
      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .set('content-type', 'application/json')
        .set('stripe-signature', header)
        .send(payload.replace('ping', 'pong'))
        .expect(400);
    });
  });
});
