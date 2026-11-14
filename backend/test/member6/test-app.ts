import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationError } from 'class-validator';
import cookieParser from 'cookie-parser';
import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommunityModule } from '../../src/community/community.module';
import { CommunityExceptionFilter } from '../../src/community/http';

@Module({})
class TestAppModule {
  static register(mongoUri: string): DynamicModule {
    return {
      module: TestAppModule,
      imports: [
        MongooseModule.forRoot(mongoUri, {
          serverSelectionTimeoutMS: 10000,
          autoIndex: true,
        }),
        CommunityModule.register(),
      ],
    };
  }
}

function fieldErrors(
  errors: ValidationError[],
  prefix = '',
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const error of errors) {
    const path = prefix ? prefix + '.' + error.property : error.property;
    if (error.constraints) result[path] = Object.values(error.constraints);
    Object.assign(result, fieldErrors(error.children ?? [], path));
  }
  return result;
}

export async function createApplication(
  mongoUri: string,
  quiet = false,
  beforeInit?: (app: NestExpressApplication) => void,
) {
  const app = await NestFactory.create<NestExpressApplication>(
    TestAppModule.register(mongoUri),
    { logger: quiet ? false : ['error', 'warn', 'log'] },
  );
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          message: 'Validation failed',
          errors: fieldErrors(errors),
        }),
    }),
  );
  app.useGlobalFilters(new CommunityExceptionFilter());
  const config = new DocumentBuilder()
    .setTitle('Travel Platform - Member 6')
    .setDescription(
      'Eyad El Safty (16003613). Blog, community, media, reporting, notifications and audit APIs. ' +
        'Authentication uses an httpOnly session cookie issued after Member 1 login. ' +
        'For writes, authorize the X-CSRF-Token value from the csrf cookie. Lists use page size 10. ' +
        'Delete and hide requests require confirm=true. Notification creation and audit recording are internal services.',
    )
    .setVersion('1.0')
    .addCookieAuth('session', { type: 'apiKey', in: 'cookie' }, 'session')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: false, withCredentials: true },
  });
  beforeInit?.(app);
  await app.init();
  return { app, document };
}
