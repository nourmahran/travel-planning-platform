import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { ProviderFlightCancellationService } from './provider-flight-cancellation.service';
import { BookingsService } from '../bookings/bookings.service';
import { UserRole } from '../auth/constants/roles';
import { CabinClass } from './schemas/flight.schema';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

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
    details: jest.fn(),
    addCabin: jest.fn(),
  };
  const mockBookings = { listForAirline: jest.fn() };
  const moderator = {
    id: 'u1',
    role: UserRole.AIRLINE_MODERATOR,
    providerId: 'airline-a',
  } as unknown as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FlightsController],
      providers: [
        {
          provide: FlightsService,
          useValue: mockFlightsService,
        },
        {
          provide: ProviderFlightCancellationService,
          useValue: { cancelForAirline: jest.fn() },
        },
        { provide: BookingsService, useValue: mockBookings },
      ],
    }).compile();

    controller = module.get<FlightsController>(FlightsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  const flightOf = (airlineId: string) => ({
    flight: { airlineId: { toString: () => airlineId } },
  });

  it('adds a cabin to a flight of the moderator airline', async () => {
    mockFlightsService.details.mockResolvedValue(flightOf('airline-a') as never);
    mockFlightsService.addCabin.mockResolvedValue({ ok: true } as never);
    await expect(
      controller.addCabin('f1', { cabinClass: CabinClass.BUSINESS } as never, moderator),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects cabin changes on another airline's flight", async () => {
    mockFlightsService.details.mockResolvedValue(flightOf('airline-b') as never);
    await expect(
      controller.addCabin('f1', { cabinClass: CabinClass.BUSINESS } as never, moderator),
    ).rejects.toThrow('Flight belongs to another airline');
    expect(mockFlightsService.addCabin).not.toHaveBeenCalled();
  });

  it('rejects an unknown cabin id', async () => {
    await expect(
      controller.updateCabin('f1', 'Galley', { price: 10 }, moderator),
    ).rejects.toThrow('cabinId must be one of');
  });

  it('updates one cabin through the flight update rules', async () => {
    mockFlightsService.details.mockResolvedValue(flightOf('airline-a') as never);
    await controller.updateCabin('f1', 'Economy', { price: 99 }, moderator);
    expect(mockFlightsService.update).toHaveBeenCalledWith('f1', {
      cabins: [{ price: 99, cabinClass: CabinClass.ECONOMY }],
    });
  });

  it("lists bookings only for the moderator's own flight", async () => {
    mockFlightsService.details.mockResolvedValue(flightOf('airline-a') as never);
    await controller.bookings('f1', moderator, '2', '10');
    expect(mockBookings.listForAirline).toHaveBeenCalledWith('f1', 'airline-a', 2, 10);
  });
});
