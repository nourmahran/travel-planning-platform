import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getConnectionToken } from '@nestjs/mongoose';
import { Global, Module } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AuthModule } from '../auth/auth.module';
import { ItinerariesModule } from './itineraries.module';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.STRIPE_SECRET_KEY =
  process.env.STRIPE_SECRET_KEY ?? 'sk_test_module_graph';
process.env.STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_module_graph';

/**
 * Every Mongo call resolves to an empty result, so the module graph boots
 * without a database.
 *
 * Two proxies, because Nest awaits whatever a provider factory returns: the
 * model itself must not look like a promise or the injector would unwrap it,
 * while the queries it hands out must resolve when awaited.
 */
const emptyResult: any = new Proxy(function query() {} as any, {
  get: (_target, property) => {
    if (property === 'then') {
      return (resolve: (value: unknown[]) => void) =>
        Promise.resolve([]).then(resolve);
    }

    return () => emptyResult;
  },
  apply: () => emptyResult,
});

const stubModel: any = new Proxy(function model() {} as any, {
  get: (_target, property) => {
    if (property === 'then') {
      return undefined;
    }

    if (property === 'modelName') {
      return 'StubModel';
    }

    return () => emptyResult;
  },
  apply: () => emptyResult,
});

const connection = {
  models: {},
  model: () => stubModel,
  collection: () => emptyResult,
  db: { collection: () => emptyResult },
};

/** Stands in for MongooseModule.forRoot without opening a connection. */
@Global()
@Module({
  providers: [{ provide: getConnectionToken(), useValue: connection }],
  exports: [getConnectionToken()],
})
class StubDatabaseModule {}

const ROUTES: [method: string, path: string][] = [
  ['post', '/itineraries'],
  ['get', '/itineraries'],
  ['get', '/itineraries/{id}'],
  ['patch', '/itineraries/{id}'],
  ['delete', '/itineraries/{id}'],
  ['post', '/itineraries/{id}/clone'],
  ['get', '/itineraries/{id}/budget-summary'],
  ['get', '/itineraries/{id}/hotels'],
  ['get', '/itineraries/{id}/flights'],
  ['post', '/itineraries/{itineraryId}/days'],
  ['patch', '/itineraries/{itineraryId}/days/reorder'],
  ['patch', '/itineraries/{itineraryId}/days/{dayId}'],
  ['delete', '/itineraries/{itineraryId}/days/{dayId}'],
  ['post', '/itineraries/{itineraryId}/days/{dayId}/activities'],
  ['patch', '/activities/{activityId}'],
  ['delete', '/activities/{activityId}'],
  ['post', '/activities/{activityId}/images'],
  ['delete', '/activities/{activityId}/images/{imageId}'],
  ['post', '/itineraries/{itineraryId}/days/{dayId}/budgets'],
  ['patch', '/budgets/{budgetId}'],
  ['delete', '/budgets/{budgetId}'],
  ['post', '/itineraries/{itineraryId}/transport-costs'],
  ['patch', '/transport-costs/{costId}'],
  ['delete', '/transport-costs/{costId}'],
  ['get', '/itineraries/public/search'],
  ['get', '/itineraries/public/{id}'],
  ['get', '/cities'],
  ['get', '/currency/convert'],
];

const GUEST_ROUTES = new Set([
  '/itineraries/public/search',
  '/itineraries/public/{id}',
  '/cities',
  '/currency/convert',
]);

describe('ItinerariesModule wiring', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        EventEmitterModule.forRoot(),
        StubDatabaseModule,
        AuthModule,
        ItinerariesModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves every provider with Member 1 auth and no database', () => {
    expect(app).toBeDefined();
  });

  it('publishes every documented route in the Swagger document', () => {
    const document: any = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').build(),
    );

    for (const [method, path] of ROUTES) {
      expect(document.paths[path]?.[method]).toBeDefined();
    }
  });

  it('advertises the access_token cookie only on the owner routes', () => {
    const document: any = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').build(),
    );

    for (const [method, path] of ROUTES) {
      const operation = document.paths[path]?.[method];

      if (GUEST_ROUTES.has(path)) {
        expect(operation?.security ?? []).toEqual([]);
      } else {
        expect(operation?.security).toEqual([{ access_token: [] }]);
      }
    }
  });

  it('answers 401 on an owner route without a session', async () => {
    await request(app.getHttpServer()).get('/itineraries').expect(401);
    await request(app.getHttpServer()).post('/itineraries').expect(401);
  });

  it('no longer trusts the retired x-dev-user-id header', async () => {
    await request(app.getHttpServer())
      .get('/itineraries')
      .set('x-dev-user-id', 'a'.repeat(24))
      .expect(401);
  });

  it('leaves the guest routes open', async () => {
    await request(app.getHttpServer()).get('/cities').expect(200);
    await request(app.getHttpServer())
      .get('/itineraries/public/search')
      .expect(200);
  });
});
