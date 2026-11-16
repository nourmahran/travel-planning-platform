import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RouterModule } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { CommunityIdentity } from '../community/auth';
import { CommunityModule } from '../community/community.module';
import { TeamIdentity } from '../community/team-identity';
import { BookingType } from '../common/booking';
import { HotelsModule } from '../hotels/hotels.module';
import { BookingGatewayRegistry } from '../payments/gateway/booking-gateway.registry';

process.env.JWT_SECRET ??= 'test-module-graph';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_module_graph';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_module_graph';

const query: any = new Proxy(function emptyQuery() {} as any, {
  get: (_target, key) =>
    key === 'then'
      ? (resolve: (value: unknown[]) => void) =>
          Promise.resolve([]).then(resolve)
      : () => query,
  apply: () => query,
});
const model: any = new Proxy(function emptyModel() {} as any, {
  get: (_target, key) =>
    key === 'then' ? undefined : key === 'modelName' ? 'Stub' : () => query,
  apply: () => query,
});

@Global()
@Module({
  providers: [
    {
      provide: getConnectionToken(),
      useValue: {
        models: {},
        model: () => model,
        collection: () => query,
        db: { collection: () => query },
      },
    },
  ],
  exports: [getConnectionToken()],
})
class StubDatabaseModule {}

describe('shared backend module wiring', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        EventEmitterModule.forRoot(),
        StubDatabaseModule,
        AuthModule,
        HotelsModule,
        CommunityModule.register({
          identityProvider: {
            provide: CommunityIdentity,
            useClass: TeamIdentity,
          },
        }),
        RouterModule.register([{ path: 'api', module: CommunityModule }]),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registers hotel bookings with the shared payment gateway', () => {
    expect(
      app.get(BookingGatewayRegistry).isRegistered(BookingType.Hotel),
    ).toBe(true);
  });

  it('publishes hotel and community routes under /api', () => {
    const paths = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    ).paths;
    expect(paths['/api/hotels/search']).toBeDefined();
    expect(paths['/api/hotel-bookings']).toBeDefined();
    expect(paths['/api/posts']).toBeDefined();
    expect(paths['/api/notifications']).toBeDefined();
  });

  it('rejects guests from owner routes and internal confirmation', async () => {
    await request(app.getHttpServer()).get('/api/hotel-bookings').expect(401);
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
    await request(app.getHttpServer()).post('/api/posts').expect(401);
    await request(app.getHttpServer())
      .post('/api/hotel-bookings/507f1f77bcf86cd799439011/confirm')
      .expect(403);
  });
});
