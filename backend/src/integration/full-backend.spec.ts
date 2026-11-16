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
    await request(http).get('/itineraries/public/search').expect(200);
    await request(http).get('/api/hotel-bookings').expect(401);
    await request(http).get('/api/notifications').expect(401);
    await request(http).post('/api/posts').expect(401);
  });

  it('uses Member 1 login for hotel and community owner routes', async () => {
    const http = app.getHttpServer();
    await request(http)
      .post('/auth/register')
      .send({
        name: 'Integration User',
        email: 'integration@example.test',
        password: 'Integration123',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
      })
      .expect(201);
    const login = await request(http)
      .post('/auth/login')
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
      .post('/auth/register')
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
      .post('/auth/login')
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
  });

  it('saves only active hotels and public itineraries for the signed-in user', async () => {
    const http = app.getHttpServer();
    await request(http).post('/auth/register').send({
      name: 'Favourite User', email: 'favourite@example.test', password: 'Integration123',
      acceptedTerms: true, acceptedPrivacyPolicy: true,
    }).expect(201);
    const login = await request(http).post('/auth/login').send({
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
    await request(http).post(`/favourites/hotel/${hotelId.toString()}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf).expect(201);
    await request(http).post(`/favourites/itinerary/${itineraryId.toString()}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf).expect(201);
    await request(http).post(`/favourites/itinerary/${privateId.toString()}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf).expect(404);
    const listed = await request(http).get('/favourites').set('Cookie', cookies).expect(200);
    expect(listed.body.total).toBe(2);
    await request(http).delete(`/favourites/hotel/${hotelId.toString()}`)
      .set('Cookie', cookies).set('x-csrf-token', csrf).expect(200);
    const after = await request(http).get('/favourites').set('Cookie', cookies).expect(200);
    expect(after.body.total).toBe(1);
  });

  it('reports provider bookings and net revenue from verified payments and refunds', async () => {
    const http = app.getHttpServer();
    await request(http).post('/auth/register').send({
      name: 'Analytics Admin', email: 'analytics-admin@example.test', password: 'Integration123',
      acceptedTerms: true, acceptedPrivacyPolicy: true,
    }).expect(201);
    const connection = app.get<Connection>(getConnectionToken());
    await connection.db!.collection('users').updateOne(
      { email: 'analytics-admin@example.test' }, { $set: { role: 'admin' } },
    );
    const login = await request(http).post('/auth/login').send({
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
    const report = await request(http).get(`/admin/analytics?from=${date}&to=${date}`)
      .set('Cookie', cookies).expect(200);
    expect(report.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'hotel', providerId: hotelId.toString(), bookings: 1, grossRevenue: 120, refunds: 20, netRevenue: 100 }),
    ]));
    await request(http).get(`/admin/analytics?from=${date}&to=${date}`).expect(401);
  });
});
