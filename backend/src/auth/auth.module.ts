import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthCookieService } from './cookies/auth-cookie.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import {
  RefreshSession,
  RefreshSessionSchema,
} from './schemas/refresh-session.schema';
import { User, UserSchema } from './schemas/user.schema';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    MailModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: RefreshSession.name, schema: RefreshSessionSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET is missing from backend/.env');
        }
        return { secret };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookieService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [AuthService, MongooseModule, JwtModule, AuthCookieService],
})
export class AuthModule {}
