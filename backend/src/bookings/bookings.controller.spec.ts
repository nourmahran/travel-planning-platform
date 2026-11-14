
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

describe('BookingsController', () => {
  let app: INestApplication;

  const validBookingId = '507f1f77bcf86cd799439011';

  const mockBookingsService = {
    create: jest.fn<(...args: any[]) => any>(),
    confirm: jest.fn<(...args: any[]) => any>(),
    cancel: jest.fn<(...args: any[]) => any>(),
  };

  beforeAll(async () => {
    const module: TestingModule =
      await Test.createTestingModule({
        controllers: [BookingsController],
        providers: [
          {
            provide: BookingsService,
            useValue: mockBookingsService,
          },
        ],
      }).compile();

    app = module.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should initialize the application', () => {
    expect(app).toBeDefined();
  });

  it('should disable public booking confirmation', async () => {
    await request(app.getHttpServer())
      .patch(`/bookings/${validBookingId}/confirm`)
      .expect(404);

    expect(mockBookingsService.confirm)
      .not.toHaveBeenCalled();
  });

  it('should not expose confirmation for invalid IDs', async () => {
    await request(app.getHttpServer())
      .patch('/bookings/invalid-id/confirm')
      .expect(404);

    expect(mockBookingsService.confirm)
      .not.toHaveBeenCalled();
  });

  it('should cancel a booking with a valid ID', async () => {
    mockBookingsService.cancel.mockReturnValue({
      id: validBookingId,
      status: 'Cancelled',
    });

    const response = await request(
      app.getHttpServer(),
    )
      .patch(`/bookings/${validBookingId}/cancel`)
      .expect(200);

    expect(response.body.status).toBe('Cancelled');

    expect(mockBookingsService.cancel)
      .toHaveBeenCalledWith(validBookingId);
  });

  it('should reject an invalid booking ID when cancelling', async () => {
    await request(app.getHttpServer())
      .patch('/bookings/invalid-id/cancel')
      .expect(400);

    expect(mockBookingsService.cancel)
      .not.toHaveBeenCalled();
  });
});
