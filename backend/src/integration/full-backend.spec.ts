import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { BookingGatewayRegistry } from '../payments/gateway/booking-gateway.registry';
import { BookingType } from '../common/booking';
import { WebhookService } from '../payments/webhook.service';
import { StripeService } from '../payments/stripe/stripe.service';
import { AdminService } from '../admin/admin.service';
import { FlightChangeExecutionService } from '../bookings/flight-change-execution.service';
import { applyApiPrefix } from '../common/http/api-prefix';

describe('combined backend against an isolated MongoDB replica set', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication;
  const original = {
    uri: process.env.MONGODB_URI,
    jwt: process.env.JWT_SECRET,
    stripe: process.env.STRIPE_SECRET_KEY,
    webhook: process.env.STRIPE_WEBHOOK_SECRET,
    nodeEnv: process.env.NODE_ENV,
    devPayments: process.env.ENABLE_DEV_PAYMENT_ENDPOINTS,
  };

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      binary: { version: '7.0.24' },
      replSet: { count: 1 },
    });
    process.env.MONGODB_URI = mongo.getUri('combined_backend_test');
    process.env.JWT_SECRET = 'combined-backend-test-secret';
    process.env.STRIPE_SECRET_KEY = 'sk_test_combined_backend';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_combined_backend';
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_PAYMENT_ENDPOINTS = 'false';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    applyApiPrefix(app);
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('MONGODB_URI', original.uri);
    restore('JWT_SECRET', original.jwt);
    restore('STRIPE_SECRET_KEY', original.stripe);
    restore('STRIPE_WEBHOOK_SECRET', original.webhook);
    restore('NODE_ENV', original.nodeEnv);
    restore('ENABLE_DEV_PAYMENT_ENDPOINTS', original.devPayments);
  }, 120_000);

  it('serves public routes and protects owner routes across modules', async () => {
    const http = app.getHttpServer();
    await request(http).get('/api/hotels/search').expect(200);
    await request(http).get('/api/posts').expect(200);
    await request(http).get('/api/itineraries/public/search').expect(200);
    await request(http).get('/api/hotel-bookings').expect(401);
    await request(http).get('/api/notifications').expect(401);
    await request(http).post('/api/posts').expect(401);
  });

  it('uses Member 1 login for hotel and community owner routes', async () => {
    const http = app.getHttpServer();
    await request(http)
      .post('/api/auth/register')
      .send({
        name: 'Integration User',
        email: 'integration@example.test',
        password: 'Integration123',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
      })
      .expect(201);
    const login = await request(http)
      .post('/api/auth/login')
      .send({
        email: 'integration@example.test',
        password: 'Integration123',
      })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    await request(http)
      .get('/api/notifications')
      .set('Cookie', cookies)
      .expect(200);
    await request(http)
      .get('/api/hotel-bookings')
      .set('Cookie', cookies)
      .expect(200);

    await request(http)
      .post('/api/auth/register')
      .send({
        name: 'Integration Admin',
        email: 'admin-integration@example.test',
        password: 'Integration123',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
      })
      .expect(201);
    const connection = app.get<Connection>(getConnectionToken());
    await connection
      .db!.collection('users')
      .updateOne(
        { email: 'admin-integration@example.test' },
        { $set: { role: 'admin' } },
      );
    const adminLogin = await request(http)
      .post('/api/auth/login')
      .send({
        email: 'admin-integration@example.test',
        password: 'Integration123',
      })
      .expect(200);
    const adminCookies = adminLogin.headers[
      'set-cookie'
    ] as unknown as string[];
    const csrf = (setCookies: string[]) => {
      const cookie = setCookies.find((value) =>
        value.startsWith('csrf_token='),
      );
      if (!cookie) throw new Error('Missing CSRF cookie');
      return decodeURIComponent(cookie.split(';')[0].split('=')[1]);
    };
    const hotel = await request(http)
      .post('/api/hotels')
      .set('Cookie', adminCookies)
      .set('x-csrf-token', csrf(adminCookies))
      .send({
        name: 'Shared Hotel',
        description:
          'A hotel used to verify the merged backend reservation and payment policy flow.',
        location: {
          city: 'Cairo',
          country: 'Egypt',
          address: '1 Integration Street',
        },
        starRating: 4,
      })
      .expect(201);
    const room = await request(http)
      .post(`/api/hotels/${hotel.body.id}/rooms`)
      .set('Cookie', adminCookies)
      .set('x-csrf-token', csrf(adminCookies))
      .send({
        roomNumber: '101',
        name: 'Double Room',
        bedType: 'queen',
        bedCount: 1,
        maxAdults: 2,
        maxChildren: 0,
        basePricePerNightCents: 12000,
      })
      .expect(201);
    const checkIn = new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const checkOut = new Date(Date.now() + 32 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const hold = await request(http)
      .post('/api/hotel-bookings')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrf(cookies))
      .send({
        hotelId: hotel.body.id,
        checkIn,
        checkOut,
        rooms: [
          {
            roomId: room.body.id,
            guests: [{ firstName: 'Guest', lastName: 'One' }],
          },
        ],
      })
      .expect(201);
    expect(hold.body.status).toBe('HELD');
    await request(http)
      .post(`/api/bookings/hotel/${hold.body.id}/accept-policies`)
      .set('Cookie', cookies)
      .set('x-csrf-token', csrf(cookies))
      .send({ accepted: true })
      .expect(200);
    const policies = await request(http)
      .get(`/api/bookings/hotel/${hold.body.id}/policies`)
      .set('Cookie', cookies)
      .expect(200);
    expect(policies.body).toBeDefined();
    const gateway = app.get(BookingGatewayRegistry).get(BookingType.Hotel);
    expect(await gateway.confirm(hold.body.id)).toBe(true);
    const confirmed = await request(http)
      .get(`/api/hotel-bookings/${hold.body.id}`)
      .set('Cookie', cookies)
      .expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    const notifications = await request(http)
      .get('/api/notifications')
      .set('Cookie', cookies)
      .expect(200);
    expect(notifications.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'booking.confirmed' }),
      ]),
    );
    const owner = await connection.db!.collection('users').findOne({ email: 'integration@example.test' });
    if (!owner) throw new Error('Integration user missing');
    const itineraryId = new Types.ObjectId();
    const dayId = new Types.ObjectId();
    await connection.db!.collection('itineraries').insertOne({
      _id: itineraryId, ownerId: owner._id, title: 'Booked trip', countries: ['EG'],
      startDate: checkIn, currency: 'USD', visibility: 'private', isHidden: false,
      days: [{ _id: dayId, dayNumber: 1, date: checkIn, cityId: 'Cairo', activities: [], budgets: [] }],
      transportCosts: [], cloneCount: 0,
    });
    const linked = await request(http)
      .post(`/api/itineraries/${itineraryId.toString()}/days/${dayId.toString()}/bookings/hotel/${hold.body.id}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf(cookies));
    if (linked.status !== 201) throw new Error(JSON.stringify(linked.body));
    expect(linked.body.bookingId).toBe(hold.body.id);
    const budget = await request(http)
      .get(`/api/itineraries/${itineraryId.toString()}/budget-summary`)
      .set('Cookie', cookies).expect(200);
    expect(budget.body.totals.categories.accommodation).toBe(240);
    const flightBookingId = new Types.ObjectId();
    await connection.db!.collection('bookings').insertOne({
      _id: flightBookingId, userId: owner._id.toString(), status: 'Confirmed', totalPrice: 75,
    });
    await request(http)
      .post(`/api/itineraries/${itineraryId.toString()}/days/${dayId.toString()}/bookings/flight/${flightBookingId.toString()}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf(cookies)).expect(201);
    const withFlight = await request(http)
      .get(`/api/itineraries/${itineraryId.toString()}/budget-summary`)
      .set('Cookie', cookies).expect(200);
    expect(withFlight.body.totals.categories.local_transport).toBe(75);
    await request(http)
      .post(`/api/itineraries/${itineraryId.toString()}/days/${dayId.toString()}/bookings/flight/${flightBookingId.toString()}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf(cookies)).expect(409);
    await connection.db!.collection('itineraries').updateOne(
      { _id: itineraryId }, { $set: { visibility: 'public' } },
    );
    const publicDetail = await request(http)
      .get(`/api/itineraries/public/${itineraryId.toString()}`).expect(200);
    expect(publicDetail.body.days[0].budgets[0].bookingId).toBeUndefined();
    const clone = await request(http)
      .post(`/api/itineraries/${itineraryId.toString()}/clone`)
      .set('Cookie', cookies).set('x-csrf-token', csrf(cookies)).send({}).expect(201);
    expect(clone.body.days[0].budgets).toEqual([]);
  });

  it('saves only active hotels and public itineraries for the signed-in user', async () => {
    const http = app.getHttpServer();
    await request(http).post('/api/auth/register').send({
      name: 'Favourite User', email: 'favourite@example.test', password: 'Integration123',
      acceptedTerms: true, acceptedPrivacyPolicy: true,
    }).expect(201);
    const login = await request(http).post('/api/auth/login').send({
      email: 'favourite@example.test', password: 'Integration123',
    }).expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const csrfCookie = cookies.find((value) => value.startsWith('csrf_token='));
    if (!csrfCookie) throw new Error('Missing CSRF cookie');
    const csrf = decodeURIComponent(csrfCookie.split(';')[0].split('=')[1]);
    const connection = app.get<Connection>(getConnectionToken());
    const hotelId = new Types.ObjectId();
    const itineraryId = new Types.ObjectId();
    const privateId = new Types.ObjectId();
    await connection.db!.collection('hotels').insertOne({ _id: hotelId, name: 'Favourite Hotel', isActive: true });
    await connection.db!.collection('itineraries').insertMany([
      { _id: itineraryId, title: 'Public trip', visibility: 'public', isHidden: false },
      { _id: privateId, title: 'Private trip', visibility: 'private', isHidden: false },
    ]);
    await request(http).post(`/api/favourites/hotel/${hotelId.toString()}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf).expect(201);
    await request(http).post(`/api/favourites/itinerary/${itineraryId.toString()}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf).expect(201);
    await request(http).post(`/api/favourites/itinerary/${privateId.toString()}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf).expect(404);
    const listed = await request(http).get('/api/favourites').set('Cookie', cookies).expect(200);
    expect(listed.body.total).toBe(2);
    await request(http).delete(`/api/favourites/hotel/${hotelId.toString()}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf).expect(200);
    const after = await request(http).get('/api/favourites').set('Cookie', cookies).expect(200);
    expect(after.body.total).toBe(1);
  });

  it('reports provider bookings and net revenue from verified payments and refunds', async () => {
    const http = app.getHttpServer();
    await request(http).post('/api/auth/register').send({
      name: 'Analytics Admin', email: 'analytics-admin@example.test', password: 'Integration123',
      acceptedTerms: true, acceptedPrivacyPolicy: true,
    }).expect(201);
    const connection = app.get<Connection>(getConnectionToken());
    await connection.db!.collection('users').updateOne(
      { email: 'analytics-admin@example.test' }, { $set: { role: 'admin' } },
    );
    const login = await request(http).post('/api/auth/login').send({
      email: 'analytics-admin@example.test', password: 'Integration123',
    }).expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const hotelId = new Types.ObjectId();
    const bookingId = new Types.ObjectId();
    const paymentId = new Types.ObjectId();
    await connection.db!.collection('hotel_bookings').insertOne({ _id: bookingId, hotelId });
    await connection.db!.collection('payments').insertOne({
      _id: paymentId, bookingType: 'hotel', bookingId,
      amount: 12000, currency: 'usd', status: 'Succeeded', succeededAt: new Date(),
    });
    await connection.db!.collection('refunds').insertOne({
      paymentId, status: 'Refunded', amount: 2000,
    });
    const date = new Date().toISOString().slice(0, 10);
    const report = await request(http).get(`/api/admin/analytics?from=${date}&to=${date}`)
      .set('Cookie', cookies).expect(200);
    expect(report.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'hotel', providerId: hotelId.toString(), bookings: 1, grossRevenue: 120, refunds: 20, netRevenue: 100 }),
    ]));
    await request(http).get(`/api/admin/analytics?from=${date}&to=${date}`).expect(401);
  });

  it('shows only unoccupied numbered flight seats', async () => {
    const connection = app.get<Connection>(getConnectionToken());
    const flightId = new Types.ObjectId();
    await connection.db!.collection('flights').insertOne({
      _id: flightId, status: 'Scheduled', departureTimeUtc: new Date(Date.now() + 86400000),
      cabins: [{ cabinClass: 'Economy', totalSeats: 3, availableSeats: 2 }],
    });
    await connection.db!.collection('bookings').insertOne({
      flightId, cabinClass: 'Economy', status: 'Confirmed',
      passengers: [{ seatNumber: 2 }],
    });
    const seats = await request(app.getHttpServer())
      .get(`/api/bookings/flights/${flightId.toString()}/seats?cabin=Economy`).expect(200);
    expect(seats.body.numberedSeats).toEqual([1, 3]);
    expect(seats.body.availableSeats).toBe(2);
  });

  it('quotes a same-route flight change without changing the confirmed booking', async () => {
    const http = app.getHttpServer();
    await request(http).post('/api/auth/register').send({
      name: 'Change User', email: 'change@example.test', password: 'Integration123',
      acceptedTerms: true, acceptedPrivacyPolicy: true,
    }).expect(201);
    const login = await request(http).post('/api/auth/login').send({
      email: 'change@example.test', password: 'Integration123',
    }).expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const connection = app.get<Connection>(getConnectionToken());
    const owner = await connection.db!.collection('users').findOne({ email: 'change@example.test' });
    if (!owner) throw new Error('Change user missing');
    const oldFlightId = new Types.ObjectId();
    const newFlightId = new Types.ObjectId();
    const bookingId = new Types.ObjectId();
    const flightBase = {
      airlineId: new Types.ObjectId(), status: 'Scheduled', departureAirport: 'CAI', arrivalAirport: 'DXB',
      departureTimeUtc: new Date(Date.now() + 30 * 86400000),
      arrivalTimeUtc: new Date(Date.now() + 30 * 86400000 + 4 * 3600000),
      departureTimeZone: 'Africa/Cairo', cabins: [{ cabinClass: 'Economy', totalSeats: 10, availableSeats: 9, price: 100 }],
    };
    await connection.db!.collection('flights').insertMany([
      { _id: oldFlightId, ...flightBase },
      { _id: newFlightId, ...flightBase, cabins: [{ ...flightBase.cabins[0], price: 150 }] },
    ]);
    await connection.db!.collection('bookings').insertOne({
      _id: bookingId, userId: owner._id.toString(), flightId: oldFlightId,
      cabinClass: 'Economy', status: 'Confirmed', totalPrice: 100,
      policySnapshot: { kind: 'flight', cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
        baggage: { freeBagsPerPassenger: 0, maxWeightKgPerBag: 20, extraBagPrice: 0, maxExtraBagsPerPassenger: 0 } },
      passengers: [{ firstName: 'Change', lastName: 'User', passportNumber: 'ABC123',
        dateOfBirth: '1990-01-01', passengerType: 'adult', fare: 100, baggageFee: 0 }],
    });
    const quote = await request(http)
      .get(`/api/bookings/${bookingId.toString()}/change-preview?flightId=${newFlightId.toString()}`)
      .set('Cookie', cookies).expect(200);
    expect(quote.body.amountDue).toBe(50);
    const unchanged = await connection.db!.collection('bookings').findOne({ _id: bookingId });
    expect(String(unchanged?.flightId)).toBe(oldFlightId.toString());
    await connection.db!.collection('payments').insertOne({
      bookingType: 'flight', bookingId, userId: owner._id, status: 'Succeeded',
      amount: 10000, currency: 'usd', stripePaymentIntentId: 'pi_original_change_test',
    });
    const csrfCookie = cookies.find((value) => value.startsWith('csrf_token='));
    if (!csrfCookie) throw new Error('Missing CSRF cookie');
    const csrf = decodeURIComponent(csrfCookie.split(';')[0].split('=')[1]);
    const requested = await request(http).post(`/api/bookings/${bookingId.toString()}/change`)
      .set('Cookie', cookies).set('x-csrf-token', csrf)
      .send({ flightId: newFlightId.toString() }).expect(201);
    expect(requested.body.amountDue).toBe(50);
    expect(requested.body.payment.bookingType).toBe('flight_change');
    const beforeWebhook = await connection.db!.collection('bookings').findOne({ _id: bookingId });
    expect(String(beforeWebhook?.flightId)).toBe(oldFlightId.toString());
    const createIntent = jest.spyOn(app.get(StripeService), 'createPaymentIntent')
      .mockResolvedValue({ id: 'pi_change_test', client_secret: 'pi_change_secret' } as never);
    try {
      const payment = await request(http).post('/api/payments')
        .set('Cookie', cookies).set('x-csrf-token', csrf)
        .send({ bookingType: 'flight_change', bookingId: requested.body.changeId }).expect(201);
      expect(payment.body.amount).toBe(50);
      expect(createIntent).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 5000 }));
    } finally { createIntent.mockRestore(); }
    await app.get(WebhookService).onPaymentSucceeded({ id: 'pi_change_test' } as never);
    const afterWebhook = await connection.db!.collection('bookings').findOne({ _id: bookingId });
    expect(String(afterWebhook?.flightId)).toBe(newFlightId.toString());
    expect(afterWebhook?.totalPrice).toBe(150);
    const date = new Date().toISOString().slice(0, 10);
    const analytics = await app.get(AdminService).analytics(date, date);
    expect(analytics.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'flight', providerId: flightBase.airlineId.toString(), grossRevenue: 50, bookings: 0 }),
    ]));
    const cancellationPreview = await request(http)
      .get(`/api/bookings/${bookingId.toString()}/cancellation-preview`)
      .set('Cookie', cookies).expect(200);
    expect(cancellationPreview.body.amount).toBe(150);
    let refundNumber = 0;
    const refundCalls = jest.spyOn(app.get(StripeService), 'createRefund')
      .mockImplementation(async () => ({ id: `re_change_cancel_${++refundNumber}`, status: 'succeeded' } as never));
    try {
      await request(http).patch(`/api/bookings/${bookingId.toString()}/cancel`)
        .set('Cookie', cookies).set('x-csrf-token', csrf).expect(200);
      expect(refundCalls).toHaveBeenCalledTimes(2);
    } finally { refundCalls.mockRestore(); }
  });

  it('changes a lower-fare flight and records the Stripe difference refund', async () => {
    const http = app.getHttpServer();
    await request(http).post('/api/auth/register').send({
      name: 'Refund Change', email: 'refund-change@example.test', password: 'Integration123',
      acceptedTerms: true, acceptedPrivacyPolicy: true,
    }).expect(201);
    const login = await request(http).post('/api/auth/login').send({
      email: 'refund-change@example.test', password: 'Integration123',
    }).expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const csrfCookie = cookies.find((value) => value.startsWith('csrf_token='));
    if (!csrfCookie) throw new Error('Missing CSRF cookie');
    const csrf = decodeURIComponent(csrfCookie.split(';')[0].split('=')[1]);
    const connection = app.get<Connection>(getConnectionToken());
    const owner = await connection.db!.collection('users').findOne({ email: 'refund-change@example.test' });
    if (!owner) throw new Error('Refund change user missing');
    const oldFlightId = new Types.ObjectId();
    const newFlightId = new Types.ObjectId();
    const bookingId = new Types.ObjectId();
    const base = { airlineId: new Types.ObjectId(), status: 'Scheduled', departureAirport: 'CAI', arrivalAirport: 'DXB',
      departureTimeUtc: new Date(Date.now() + 40 * 86400000),
      arrivalTimeUtc: new Date(Date.now() + 40 * 86400000 + 4 * 3600000),
      departureTimeZone: 'Africa/Cairo', cabins: [{ cabinClass: 'Economy', totalSeats: 10, availableSeats: 9, price: 200 }] };
    await connection.db!.collection('flights').insertMany([
      { _id: oldFlightId, ...base },
      { _id: newFlightId, ...base, cabins: [{ ...base.cabins[0], price: 150 }] },
    ]);
    await connection.db!.collection('bookings').insertOne({
      _id: bookingId, userId: owner._id.toString(), flightId: oldFlightId,
      cabinClass: 'Economy', status: 'Confirmed', totalPrice: 200,
      passengers: [{ firstName: 'Refund', lastName: 'Change', passportNumber: 'ABC123',
        dateOfBirth: '1990-01-01', passengerType: 'adult', fare: 200, baggageFee: 0 }],
    });
    await connection.db!.collection('payments').insertOne({
      bookingType: 'flight', bookingId, userId: owner._id, status: 'Succeeded',
      amount: 20000, currency: 'usd', stripePaymentIntentId: 'pi_original_refund_change',
    });
    const stripe = app.get(StripeService);
    const refundCall = jest.spyOn(stripe, 'createRefund').mockResolvedValue({ id: 're_fare_change_test', status: 'succeeded' } as never);
    try {
      const changed = await request(http).post(`/api/bookings/${bookingId.toString()}/change`)
        .set('Cookie', cookies).set('x-csrf-token', csrf)
        .send({ flightId: newFlightId.toString() }).expect(201);
      expect(changed.body.amountDue).toBe(0);
      expect(changed.body.refundAmount).toBe(50);
      const booking = await connection.db!.collection('bookings').findOne({ _id: bookingId });
      expect(String(booking?.flightId)).toBe(newFlightId.toString());
      expect(booking?.totalPrice).toBe(150);
      expect(refundCall).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 5000 }));
      const refund = await connection.db!.collection('refunds').findOne({ bookingId: new Types.ObjectId(changed.body.changeId as string) });
      expect(refund?.status).toBe('Refunded');
    } finally { refundCall.mockRestore(); }
  });

  it('releases an expired replacement hold and refunds a late fare payment', async () => {
    const http = app.getHttpServer();
    await request(http).post('/api/auth/register').send({
      name: 'Late Change', email: 'late-change@example.test', password: 'Integration123',
      acceptedTerms: true, acceptedPrivacyPolicy: true,
    }).expect(201);
    const login = await request(http).post('/api/auth/login').send({
      email: 'late-change@example.test', password: 'Integration123',
    }).expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const csrfCookie = cookies.find((value) => value.startsWith('csrf_token='));
    if (!csrfCookie) throw new Error('Missing CSRF cookie');
    const csrf = decodeURIComponent(csrfCookie.split(';')[0].split('=')[1]);
    const connection = app.get<Connection>(getConnectionToken());
    const owner = await connection.db!.collection('users').findOne({ email: 'late-change@example.test' });
    if (!owner) throw new Error('Late change user missing');
    const oldFlightId = new Types.ObjectId();
    const newFlightId = new Types.ObjectId();
    const bookingId = new Types.ObjectId();
    const base = { airlineId: new Types.ObjectId(), status: 'Scheduled',
      departureAirport: 'CAI', arrivalAirport: 'DXB',
      departureTimeUtc: new Date(Date.now() + 45 * 86400000),
      arrivalTimeUtc: new Date(Date.now() + 45 * 86400000 + 4 * 3600000),
      departureTimeZone: 'Africa/Cairo', cabins: [{ cabinClass: 'Economy', totalSeats: 10, availableSeats: 9, price: 100 }] };
    await connection.db!.collection('flights').insertMany([
      { _id: oldFlightId, ...base },
      { _id: newFlightId, ...base, cabins: [{ ...base.cabins[0], price: 150 }] },
    ]);
    await connection.db!.collection('bookings').insertOne({
      _id: bookingId, userId: owner._id.toString(), flightId: oldFlightId,
      cabinClass: 'Economy', status: 'Confirmed', totalPrice: 100,
      passengers: [{ firstName: 'Late', lastName: 'Change', passportNumber: 'ABC123',
        dateOfBirth: '1990-01-01', passengerType: 'adult', fare: 100, baggageFee: 0 }],
    });
    await connection.db!.collection('payments').insertOne({
      bookingType: 'flight', bookingId, userId: owner._id, status: 'Succeeded',
      amount: 10000, currency: 'usd', stripePaymentIntentId: 'pi_original_late_change',
    });
    const requested = await request(http).post(`/api/bookings/${bookingId.toString()}/change`)
      .set('Cookie', cookies).set('x-csrf-token', csrf)
      .send({ flightId: newFlightId.toString() }).expect(201);
    const changeId = new Types.ObjectId(requested.body.changeId as string);
    await connection.db!.collection('payments').insertOne({
      bookingType: 'flight_change', bookingId: changeId, userId: owner._id,
      status: 'Pending', amount: 5000, currency: 'usd', stripePaymentIntentId: 'pi_late_change',
    });
    await connection.db!.collection('flight_changes').updateOne({ _id: changeId },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
    expect(await app.get(FlightChangeExecutionService).expire(changeId.toString())).toBe(true);
    const replacement = await connection.db!.collection('flights').findOne({ _id: newFlightId });
    expect(replacement?.cabins?.[0]?.availableSeats).toBe(9);
    const refundCall = jest.spyOn(app.get(StripeService), 'createRefund')
      .mockResolvedValue({ id: 're_late_change', status: 'succeeded' } as never);
    try {
      await app.get(WebhookService).onPaymentSucceeded({ id: 'pi_late_change' } as never);
      expect(refundCall).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 5000 }));
    } finally { refundCall.mockRestore(); }
    const unchanged = await connection.db!.collection('bookings').findOne({ _id: bookingId });
    expect(String(unchanged?.flightId)).toBe(oldFlightId.toString());
  });
});
