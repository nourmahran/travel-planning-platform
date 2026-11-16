import { AirportsController } from './airports/airports.controller';
import { ScheduleModule } from '@nestjs/schedule';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DevPaymentsModule } from './payments/dev-payments.module';
import { PaymentsModule } from './payments/payments.module';
import { PoliciesModule } from './policies/policies.module';
import { AirlinesModule } from './airlines/airlines.module';
import { FlightsModule } from './flights/flights.module';
import { BookingsModule } from './bookings/bookings.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { CurrencyModule } from './currency/currency.module';
import { ItinerariesModule } from './itineraries/itineraries.module';
import { ReferenceDataModule } from './reference-data/reference-data.module';

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
                    servers?: Map<
                      string,
                      { error?: Error }
                    >;
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
    // Domain events (payment.succeeded, refund.created, ...) — PAY-01, PAY-03
    EventEmitterModule.forRoot(),
    PaymentsModule,
    PoliciesModule,
    // Dev-only Swagger helper; registers nothing unless ENABLE_DEV_PAYMENT_ENDPOINTS=true
    DevPaymentsModule.register(),
    AirlinesModule,
    FlightsModule,
    BookingsModule,
    AuthModule,
    UsersModule,
    AdminModule,
    ReferenceDataModule,
    CurrencyModule,
    ItinerariesModule,
  ],
  controllers: [AppController, AirportsController],
  providers: [AppService],
})
export class AppModule {}
