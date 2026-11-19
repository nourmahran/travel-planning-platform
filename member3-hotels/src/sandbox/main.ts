import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './api-exception.filter';
import { SandboxModule } from './sandbox.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(SandboxModule, { bufferLogs: false });

  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Travel Planning and Booking Platform — Hotels (Member 3)')
    .setDescription(
      [
        'Hotels, rooms, availability, reservations and reviews (HTL-01 … HTL-24).',
        '',
        'MONEY: every amount is an integer in minor units (cents) of the single platform currency (PAY-18).',
        '',
        'STANDALONE AUTH: set AUTH_DEV_MODE=true and send x-user-id (24-hex ObjectId) + x-user-role (USER | HOTEL_MODERATOR | ADMIN).',
        'Replace these headers with Member 1\'s httpOnly cookie session when the real auth guard is merged.',
        '',
        'INTERNAL: payment confirmation/refund endpoints require x-internal-api-key (INTERNAL_API_KEY) or an administrator.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addCookieAuth('session')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-user-id' }, 'sandbox-user-id')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-user-role' }, 'sandbox-user-role')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-internal-api-key' }, 'internal-api-key')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tagsSorter: 'alpha' },
    customSiteTitle: 'Hotels API — Member 3',
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  Logger.log(`Hotels sandbox running on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Swagger UI:              http://localhost:${port}/docs`, 'Bootstrap');
  Logger.log(`OpenAPI JSON:            http://localhost:${port}/docs-json`, 'Bootstrap');
  if (process.env.AUTH_DEV_MODE !== 'true') {
    Logger.warn('AUTH_DEV_MODE is not true: send a real session or enable it to use x-user-* headers.', 'Bootstrap');
  }
}

void bootstrap();
