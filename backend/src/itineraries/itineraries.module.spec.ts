import { ConfigModule } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Global, Module } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';

import { ItinerariesModule } from './itineraries.module';

const connection = {
  models: {},
  model: () => ({}),
  collection: () => ({ findOne: () => null, find: () => ({ toArray: () => [] }) }),
  db: {},
};

/** Stands in for MongooseModule.forRoot without opening a connection. */
@Global()
@Module({
  providers: [{ provide: getConnectionToken(), useValue: connection }],
  exports: [getConnectionToken()],
})
class StubDatabaseModule {}

/**
 * Boots the real module graph with a stubbed Mongoose connection, so a missing
 * provider, an unregistered controller or a broken route is caught without a
 * database. The Swagger document is exactly what /api will serve.
 */
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

describe('ItinerariesModule wiring', () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        StubDatabaseModule,
        ItinerariesModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('resolves every provider without a database', () => {
    expect(app).toBeDefined();
  });

  it('publishes every documented route in the Swagger document', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').build(),
    );

    for (const [method, path] of ROUTES) {
      expect(document.paths[path]?.[method]).toBeDefined();
    }
  });

  it('keeps the public routes unauthenticated and the owner routes protected', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').build(),
    );

    for (const [method, path] of ROUTES) {
      const operation = document.paths[path]?.[method];

      if (path.startsWith('/itineraries/public') || path === '/cities' || path === '/currency/convert') {
        expect(operation?.security ?? []).toHaveLength(0);
      } else {
        expect(operation?.security).toEqual([{ bearer: [] }]);
      }
    }
  });
});
