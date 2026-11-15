
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { FlightsService } from './flights.service';
import { Flight } from './schemas/flight.schema';
import { Airline } from '../airlines/schemas/airline.schema';

describe('FlightsService', () => {
  let service: FlightsService;

  const mockFlightModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };

  const mockAirlineModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
  };

  const mockConnection = {
    startSession: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          FlightsService,
          {
            provide: getModelToken(Flight.name),
            useValue: mockFlightModel,
          },
          {
            provide: getModelToken(Airline.name),
            useValue: mockAirlineModel,
          },
          {
            provide: getConnectionToken(),
            useValue: mockConnection,
          },
        ],
      }).compile();

    service = module.get<FlightsService>(FlightsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
