
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

describe('BookingsController', () => {
  let controller: BookingsController;

  const mockBookingsService = {
    create: jest.fn(),
    confirm: jest.fn(),
    cancel: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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

    controller = module.get<BookingsController>(
      BookingsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
