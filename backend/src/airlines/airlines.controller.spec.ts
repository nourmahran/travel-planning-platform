
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';

describe('AirlinesController', () => {
  let controller: AirlinesController;

  const mockAirlinesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        controllers: [AirlinesController],
        providers: [
          {
            provide: AirlinesService,
            useValue: mockAirlinesService,
          },
        ],
      }).compile();

    controller = module.get<AirlinesController>(
      AirlinesController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
