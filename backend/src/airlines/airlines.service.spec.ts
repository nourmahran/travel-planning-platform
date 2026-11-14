
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AirlinesService } from './airlines.service';
import { Airline } from './schemas/airline.schema';

describe('AirlinesService', () => {
  let service: AirlinesService;

  const mockAirlineModel = {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          AirlinesService,
          {
            provide: getModelToken(Airline.name),
            useValue: mockAirlineModel,
          },
        ],
      }).compile();

    service = module.get<AirlinesService>(AirlinesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
