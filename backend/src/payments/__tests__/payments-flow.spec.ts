import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import type Stripe from 'stripe';
import request from 'supertest';
import { BookingStatus, BookingType } from '../../common/booking';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { PoliciesModule } from '../../policies/policies.module';
import { DevPaymentsModule } from '../dev-payments.module';
import { BookingGatewayRegistry } from '../gateway/booking-gateway.registry';
import { NOTIFICATION_PORT } from '../gateway/notification.port';
import { PaymentsModule } from '../payments.module';
import { Payment } from '../schemas/payment.schema';
import { ProcessedEvent } from '../schemas/processed-event.schema';
import { Refund } from '../schemas/refund.schema';
import { STRIPE_CLIENT } from '../stripe/stripe.provider';
import { StripeService } from '../stripe/stripe.service';
import { FakeBookingGateway } from './fake-booking.gateway';
import { FakeStripe, makeModels, TestAuthGuard } from './test-helpers';

/**
 * Wiring test: the REAL modules, controllers, guards, DTO validation and the
 * global error filter, with only MongoDB and Stripe replaced by fakes.
 * Walks the whole Swagger demo flow over HTTP.
 */
describe('Payments flow over HTTP (module wiring)', () => {
  let app: INestApplication;
  let flights: FakeBookingGateway;
  let stripe: FakeStripe;
  const models = makeModels();
  const userId = new Types.ObjectId().toString();
  const otherUser = new Types.ObjectId().toString();
  const envBackup = { ...process.env };

  beforeAll(async () => {
    process.env.ENABLE_DEV_PAYMENT_ENDPOINTS = 'true';
    process.env.NODE_ENV = 'test';
    process.env.PLATFORM_CURRENCY = 'usd';
    stripe = new FakeStripe();
    // The webhook body is "signed" if the signature header says so (real
    // signature checking is covered in webhook.spec.ts).
    stripe.constructWebhookEvent.mockImplementation(
      (raw: Buffer, sig: string) => {
        if (sig !== 'valid') throw new Error('bad signature');
        return JSON.parse(raw.toString()) as Stripe.Event;
      },
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        EventEmitterModule.forRoot(),
        PaymentsModule,
        PoliciesModule,
        DevPaymentsModule.register(),
      ],
      // Stand-in for the auth module's global JwtAuthGuard.
      providers: [{ provide: APP_GUARD, useClass: TestAuthGuard }],
    })
      .overrideProvider(getModelToken(Payment.name))
      .useValue(models.payments)
      .overrideProvider(getModelToken(Refund.name))
      .useValue(models.refunds)
      .overrideProvider(getModelToken(ProcessedEvent.name))
      .useValue(models.events)
      .overrideProvider(STRIPE_CLIENT)
      .useValue({})
      .overrideProvider(StripeService)
      .useValue(stripe)
      .overrideProvider(NOTIFICATION_PORT)
      .useValue({ notify: async () => {} })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    flights = new FakeBookingGateway(BookingType.Flight);
    app.get(BookingGatewayRegistry).register(flights);
  });

  afterAll(async () => {
    await app.close();
    process.env = envBackup;
  });

  const http = () => request(app.getHttpServer());
  const as = (id: string) => ({ 'x-test-user-id': id });

  it('full flow: policies → payment → dev confirm → webhook → Confirmed', async () => {
    const booking = flights.seed({
      id: new Types.ObjectId().toString(),
      userId,
    });

    // Payment is blocked before policies are accepted (PAY-02)
    const blocked = await http()
      .post('/api/payments')
      .set(as(userId))
      .send({ bookingType: 'flight', bookingId: booking.id })
      .expect(400);
    expect(blocked.body).toMatchObject({
      statusCode: 400,
      message: 'Policies must be accepted before payment',
      path: '/api/payments',
    });

    const policies = await http()
      .get(`/api/bookings/flight/${booking.id}/policies`)
      .set(as(userId))
      .expect(200);
    expect(policies.body).toMatchObject({
      accepted: false,
      policies: { kind: 'flight' },
    });

    await http()
      .post(`/api/bookings/flight/${booking.id}/accept-policies`)
      .set(as(userId))
      .send({ accepted: true })
      .expect(200);

    const created = await http()
      .post('/api/payments')
      .set(as(userId))
      .send({ bookingType: 'flight', bookingId: booking.id })
      .expect(201);
    expect(created.body).toMatchObject({
      amount: 250.5,
      currency: 'usd',
      status: 'Pending',
    });
    expect(created.body.clientSecret).toContain('_secret_');

    const { paymentId } = created.body as { paymentId: string };
    const confirmed = await http()
      .post(`/api/dev/payments/${paymentId}/confirm`)
      .set(as(userId))
      .send({ testPaymentMethod: 'pm_card_visa' })
      .expect(200);
    expect(confirmed.body.paymentIntentStatus).toBe('succeeded');
    // Not confirmed yet — only the webhook may do that.
    expect(flights.bookings.get(booking.id)?.status).toBe(
      BookingStatus.PendingPayment,
    );

    const piId = models.payments.get(paymentId)!
      .stripePaymentIntentId as string;
    await http()
      .post('/api/payments/webhook')
      .set('stripe-signature', 'valid')
      .set('content-type', 'application/json')
      .send(
        JSON.stringify({
          id: 'evt_flow_1',
          type: 'payment_intent.succeeded',
          data: { object: { id: piId } },
        }),
      )
      .expect(200, { received: true });
    expect(flights.bookings.get(booking.id)?.status).toBe(
      BookingStatus.Confirmed,
    );

    const got = await http()
      .get(`/api/payments/${paymentId}`)
      .set(as(userId))
      .expect(200);
    expect(got.body).toMatchObject({ status: 'Succeeded', amount: 250.5 });

    // Another user cannot see it (404, not 403)
    await http()
      .get(`/api/payments/${paymentId}`)
      .set(as(otherUser))
      .expect(404);
  });

  it('documents every route in Swagger with its requirement ID (Task 13)', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('t').addCookieAuth('access_token').build(),
    );
    const expected: Array<[string, string, string]> = [
      ['get', '/api/bookings/{type}/{id}/policies', 'PAY-02'],
      ['post', '/api/bookings/{type}/{id}/accept-policies', 'PAY-02'],
      ['post', '/api/payments', 'PAY-01'],
      ['post', '/api/payments/{id}/retry', 'PAY-01'],
      ['get', '/api/payments/{id}', 'PAY-01'],
      ['post', '/api/payments/webhook', 'PAY-01'],
      ['get', '/api/refunds/{id}', 'PAY-03'],
      ['post', '/api/dev/payments/{id}/confirm', 'PAY-01'],
    ];
    for (const [method, path, req] of expected) {
      const op = (
        doc.paths[path] as Record<
          string,
          {
            summary?: string;
            tags?: string[];
            responses: Record<string, unknown>;
          }
        >
      )?.[method];
      expect({ path, method, summary: op?.summary }).toEqual({
        path,
        method,
        summary: expect.stringContaining(req),
      });
      expect(Object.keys(op.responses).length).toBeGreaterThan(1);
    }
    const tags = new Set(
      Object.values(doc.paths).flatMap((p) =>
        Object.values(p as Record<string, { tags?: string[] }>).flatMap(
          (o) => o.tags ?? [],
        ),
      ),
    );
    for (const t of [
      'Payments',
      'Policies',
      'Refunds',
      'Dev (test mode only)',
    ]) {
      expect(tags).toContain(t);
    }
  });

  it('validates input with 400 and requires login with 401', async () => {
    await http()
      .post('/api/payments')
      .send({
        bookingType: 'flight',
        bookingId: new Types.ObjectId().toString(),
      })
      .expect(401);
    await http()
      .post('/api/payments')
      .set(as(userId))
      .send({ bookingType: 'train', bookingId: 'nope' })
      .expect(400);
    await http()
      .post('/api/payments')
      .set(as(userId))
      .send({
        bookingType: 'flight',
        bookingId: new Types.ObjectId().toString(),
        amount: 1,
      })
      .expect(400); // amount is not accepted from the client
    await http()
      .get('/api/bookings/bus/123/policies')
      .set(as(userId))
      .expect(400);
    await http()
      .post('/api/dev/payments/' + new Types.ObjectId().toString() + '/confirm')
      .set(as(userId))
      .send({ testPaymentMethod: '4242424242424242' })
      .expect(400);
  });

  it('returns 503 for a booking type that is not wired yet', async () => {
    await http()
      .post('/api/payments')
      .set(as(userId))
      .send({
        bookingType: 'hotel',
        bookingId: new Types.ObjectId().toString(),
      })
      .expect(503);
  });

  it('rejects unsigned webhooks with 400', async () => {
    await http()
      .post('/api/payments/webhook')
      .set('content-type', 'application/json')
      .send({ id: 'evt_x', type: 'payment_intent.succeeded' })
      .expect(400);
  });
});
