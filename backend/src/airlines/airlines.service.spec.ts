
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

  const airlineDoc = (flightPolicies?: unknown) => {
    const doc = {
      flightPolicies,
      markModified: jest.fn(),
      save: jest.fn(),
    };
    doc.save.mockImplementation(async () => doc);
    mockAirlineModel.findById.mockReturnValue({
      exec: async () => doc,
    } as never);
    return doc;
  };
  const baggage = {
    freeBagsPerPassenger: 1,
    maxWeightKgPerBag: 23,
    extraBagPrice: 50,
    maxExtraBagsPerPassenger: 2,
  };

  it('requires a cancellation policy before baggage can be replaced', async () => {
    airlineDoc(undefined);
    await expect(service.setBaggagePolicy('a1', baggage)).rejects.toThrow(
      'set the cancellation policy first',
    );
  });

  it('replaces the baggage policy and keeps cancellation tiers', async () => {
    const tiers = [{ daysBefore: 7, refundPercent: 80 }];
    const doc = airlineDoc({ kind: 'flight', cancellationTiers: tiers, baggage: {} });
    const saved = (await service.setBaggagePolicy('a1', baggage)) as unknown as typeof doc;
    expect(saved.flightPolicies).toEqual({ kind: 'flight', cancellationTiers: tiers, baggage });
  });

  it('creates policies from cancellation tiers with no free bags yet', async () => {
    const doc = airlineDoc(undefined);
    await service.setCancellationPolicy('a1', [{ daysBefore: 3, refundPercent: 50 }]);
    expect(doc.flightPolicies).toMatchObject({
      cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
      baggage: { freeBagsPerPassenger: 0, maxExtraBagsPerPassenger: 0 },
    });
  });

  it('rejects duplicate cancellation day thresholds', async () => {
    await expect(
      service.setCancellationPolicy('a1', [
        { daysBefore: 3, refundPercent: 50 },
        { daysBefore: 3, refundPercent: 20 },
      ]),
    ).rejects.toThrow('unique day thresholds');
  });
});

