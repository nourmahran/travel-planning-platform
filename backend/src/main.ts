import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as dns from 'node:dns';
import { AppModule } from './app.module';

dns.setServers(['8.8.8.8']);

async function bootstrap() {
  // rawBody: Stripe webhook signature verification needs the exact raw bytes (PAY-01)
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalFilters(new HttpExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Travel Planning and Booking Platform')
    .setDescription('Software Project I - Milestone 1 REST API')
    .setVersion('1.0')
    .addTag('Authentication')
    .addTag('Airlines')
    .addTag('Flights')
    .addTag('Hotels')
    .addTag('Payments')
    .addTag('Itineraries')
    .addTag('Blog')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
