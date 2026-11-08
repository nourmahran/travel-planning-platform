
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DevPaymentsModule } from './payments/dev-payments.module';
import { PaymentsModule } from './payments/payments.module';
import { PoliciesModule } from './policies/policies.module';

@Module({
  imports: [
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

        return { uri };
      },
    }),
    // Domain events (payment.succeeded, refund.created, ...) — PAY-01, PAY-03
    EventEmitterModule.forRoot(),
    PaymentsModule,
    PoliciesModule,
    // Dev-only Swagger helper; registers nothing unless ENABLE_DEV_PAYMENT_ENDPOINTS=true
    DevPaymentsModule.register(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
