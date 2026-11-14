
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AirlinesModule } from './airlines/airlines.module';
import { FlightsModule } from './flights/flights.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';

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

    AirlinesModule,
    FlightsModule,
    AuthModule,
    UsersModule,
    AdminModule,
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
