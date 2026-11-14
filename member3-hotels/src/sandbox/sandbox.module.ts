import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { envString } from '../shared/utils/env.util';
import { HotelsModule } from '../hotels/hotels.module';
import { SandboxController } from './sandbox.controller';

/**
 * Minimal application used to run and demo the hotels module before the team's
 * AppModule exists. Member 2's real AppModule only needs to import HotelsModule
 * (plus ScheduleModule.forRoot() once).
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => {
        const uri = envString('MONGODB_URI', '');
        if (!uri) {
          throw new Error(
            'MONGODB_URI is missing. Copy .env.example to .env and add the shared MongoDB Atlas connection string.',
          );
        }
        return { uri };
      },
    }),
    ScheduleModule.forRoot(),
    HotelsModule,
  ],
  controllers: [SandboxController],
})
export class SandboxModule {}
