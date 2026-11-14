import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { AirlinesModule } from './airlines/airlines.module';
import { AirportsController } from './airports/airports.controller';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtCommunityIdentity } from './auth/community/jwt-community.identity';
import { BookingsModule } from './bookings/bookings.module';
import { CommunityIdentity } from './community/auth';
import { CommunityModule } from './community/community.module';
import { FlightsModule } from './flights/flights.module';
import { DevPaymentsModule } from './payments/dev-payments.module';
import { PaymentsModule } from './payments/payments.module';
import { PoliciesModule } from './policies/policies.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('MONGODB_URI');

        if (!uri) {
          throw new Error('MONGODB_URI is missing from backend/.env');
        }

        return {
          uri,
          serverSelectionTimeoutMS: 15000,
          onConnectionCreate: (connection) => {
            connection.on('error', (error: Error) => {
              console.error(
                'MongoDB connection error:',
                error.name,
                error.message,
              );

              const reason = (
                error as Error & {
                  reason?: {
                    servers?: Map<string, { error?: Error }>;
                  };
                }
              ).reason;

              if (reason?.servers) {
                for (const [host, server] of reason.servers) {
                  console.error(
                    'MongoDB server:',
                    host,
                    server.error?.name,
                    server.error?.message,
                  );
                }
              }
            });

            return connection;
          },
        };
      },
    }),
    EventEmitterModule.forRoot(),
    AuthModule,
    UsersModule,
    AdminModule,
    AirlinesModule,
    FlightsModule,
    BookingsModule,
    PaymentsModule,
    PoliciesModule,
    DevPaymentsModule.register(),
    CommunityModule.register({
      imports: [AuthModule],
      identityProvider: {
        provide: CommunityIdentity,
        useClass: JwtCommunityIdentity,
      },
    }),
  ],
  controllers: [AppController, AirportsController],
  providers: [AppService],
})
export class AppModule {}
