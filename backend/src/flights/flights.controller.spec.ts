
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';

describe('FlightsController', () => {
  let controller: FlightsController;

  const mockFlightsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    search: jest.fn(),
    searchRoundTrip: jest.fn(),
    cancel: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        controllers: [FlightsController],
        providers: [
          {
            provide: FlightsService,
            useValue: mockFlightsService,
          },
        ],
      }).compile();

    controller = module.get<FlightsController>(
      FlightsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
