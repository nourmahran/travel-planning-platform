
import { jest } from '@jest/globals';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { BookingsService } from './bookings.service';
import {
  Booking,
  BookingStatus,
} from './schemas/booking.schema';
import {
  CabinClass,
  Flight,
  FlightStatus,
} from '../flights/schemas/flight.schema';
import { CreateBookingDto } from './dto/create-booking.dto';

describe('BookingsService', () => {
  let service: BookingsService;

  const mockBookingModel = {
  findById: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  create: jest.fn(),
    db: {
      startSession: jest.fn(),
    },
  };

  const mockFlightModel = {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          BookingsService,
          {
            provide: getModelToken(Booking.name),
            useValue: mockBookingModel,
          },
          {
            provide: getModelToken(Flight.name),
            useValue: mockFlightModel,
          },
        ],
      }).compile();

    service = module.get<BookingsService>(
      BookingsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('confirm', () => {
    it('should reject an invalid booking ID', async () => {
      await expect(
        service.confirm('invalid-id'),
      ).rejects.toThrow(BadRequestException);

      expect(mockBookingModel.findById)
        .not.toHaveBeenCalled();
    });

    it('should reject a booking that does not exist', async () => {
      const bookingId = '507f1f77bcf86cd799439011';

      mockBookingModel.findById.mockReturnValue({
        exec: jest.fn<() => Promise<null>>()
          .mockResolvedValue(null),
      });

      await expect(
        service.confirm(bookingId),
      ).rejects.toThrow(NotFoundException);

      expect(mockBookingModel.findById)
        .toHaveBeenCalledWith(bookingId);
    });

    it('should confirm a pending booking', async () => {
      const bookingId = '507f1f77bcf86cd799439011';
      const flightId = '507f1f77bcf86cd799439012';

      const pendingBooking = {
        _id: bookingId,
        flightId,
        status: BookingStatus.PENDING,
      };

      const scheduledFlight = {
        status: FlightStatus.SCHEDULED,
        departureTimeUtc: new Date('2030-12-01T10:00:00Z'),
      };

      const confirmedBooking = {
        ...pendingBooking,
        status: BookingStatus.CONFIRMED,
        confirmedAt: new Date(),
      };

      mockBookingModel.findById.mockReturnValue({
        exec: jest.fn<
          () => Promise<typeof pendingBooking>
        >().mockResolvedValue(pendingBooking),
      });

      mockFlightModel.findById.mockReturnValue({
        exec: jest.fn<
          () => Promise<typeof scheduledFlight>
        >().mockResolvedValue(scheduledFlight),
      });

      mockBookingModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn<
          () => Promise<typeof confirmedBooking>
        >().mockResolvedValue(confirmedBooking),
      });

      const result = await service.confirm(bookingId);

      expect(result).toEqual(confirmedBooking);

      expect(mockBookingModel.findById)
        .toHaveBeenCalledWith(bookingId);

      expect(mockFlightModel.findById)
        .toHaveBeenCalledWith(flightId);

      expect(mockBookingModel.findOneAndUpdate)
        .toHaveBeenCalledWith(
          {
            _id: bookingId,
            status: BookingStatus.PENDING,
          },
          {
            $set: {
              status: BookingStatus.CONFIRMED,
              confirmedAt: expect.any(Date),
            },
          },
          {
            new: true,
            runValidators: true,
          },
        );
    });
  });

  describe('cancel', () => {
    it('should reject an invalid booking ID', async () => {
      await expect(
        service.cancel('invalid-id'),
      ).rejects.toThrow(BadRequestException);

      expect(mockBookingModel.db.startSession)
        .not.toHaveBeenCalled();
    });

    it('should prevent cancelling an already cancelled booking', async () => {
      const bookingId = '507f1f77bcf86cd799439011';

      const cancelledBooking = {
        _id: bookingId,
        status: BookingStatus.CANCELLED,
      };

      const mockSession = {
        withTransaction: jest.fn<
          (callback: () => Promise<void>) => Promise<void>
        >().mockImplementation(async (callback) => {
          await callback();
        }),
        endSession: jest.fn<
          () => Promise<void>
        >().mockResolvedValue(undefined),
      };

      mockBookingModel.db.startSession.mockReturnValue(
        mockSession,
      );

      mockBookingModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn<
            () => Promise<typeof cancelledBooking>
          >().mockResolvedValue(cancelledBooking),
        }),
      });

      await expect(
        service.cancel(bookingId),
      ).rejects.toThrow(
        'Booking is already cancelled',
      );

      expect(mockFlightModel.findOneAndUpdate)
        .not.toHaveBeenCalled();

      expect(mockBookingModel.findOneAndUpdate)
        .not.toHaveBeenCalled();

      expect(mockSession.endSession)
        .toHaveBeenCalledTimes(1);
    });

    it('should cancel a booking and restore exactly 2 seats', async () => {
      const bookingId = '507f1f77bcf86cd799439011';
      const flightId = '507f1f77bcf86cd799439012';

      const booking = {
        _id: bookingId,
        flightId,
        status: BookingStatus.CONFIRMED,
        cabinClass: CabinClass.ECONOMY,
        passengers: [
          { firstName: 'Ali', lastName: 'Ahmed' },
          { firstName: 'Omar', lastName: 'Hassan' },
        ],
      };

      const flight = {
        _id: flightId,
        status: FlightStatus.SCHEDULED,
        departureTimeUtc: new Date('2030-12-01T10:00:00Z'),
        cabins: [
          {
            cabinClass: CabinClass.ECONOMY,
            totalSeats: 100,
            availableSeats: 98,
          },
        ],
      };

      const updatedFlight = {
        ...flight,
        cabins: [
          {
            cabinClass: CabinClass.ECONOMY,
            totalSeats: 100,
            availableSeats: 100,
          },
        ],
      };

      const cancelledBooking = {
        ...booking,
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
      };

      const mockSession = {
        withTransaction: jest.fn<
          (callback: () => Promise<void>) => Promise<void>
        >().mockImplementation(async (callback) => {
          await callback();
        }),
        endSession: jest.fn<
          () => Promise<void>
        >().mockResolvedValue(undefined),
      };

      mockBookingModel.db.startSession.mockReturnValue(
        mockSession,
      );

      mockBookingModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn<
            () => Promise<typeof booking>
          >().mockResolvedValue(booking),
        }),
      });

      mockFlightModel.findById.mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn<
            () => Promise<typeof flight>
          >().mockResolvedValue(flight),
        }),
      });

      mockFlightModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn<
          () => Promise<typeof updatedFlight>
        >().mockResolvedValue(updatedFlight),
      });

      mockBookingModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn<
          () => Promise<typeof cancelledBooking>
        >().mockResolvedValue(cancelledBooking),
      });

      const result = await service.cancel(bookingId);

      expect(result).toEqual(cancelledBooking);

      expect(result?.status)
        .toBe(BookingStatus.CANCELLED);

      expect(mockFlightModel.findOneAndUpdate)
        .toHaveBeenCalledWith(
          expect.objectContaining({
            _id: flightId,
            status: FlightStatus.SCHEDULED,
            cabins: {
              $elemMatch: {
                cabinClass: CabinClass.ECONOMY,
                availableSeats: {
                  $lte: 98,
                },
              },
            },
          }),
          {
            $inc: {
              'cabins.$.availableSeats': 2,
            },
          },
          {
            new: true,
            session: mockSession,
          },
        );

      expect(mockBookingModel.findOneAndUpdate)
        .toHaveBeenCalledWith(
          {
            _id: bookingId,
            status: {
              $in: [
                BookingStatus.PENDING,
                BookingStatus.CONFIRMED,
              ],
            },
          },
          {
            $set: {
              status: BookingStatus.CANCELLED,
              cancelledAt: expect.any(Date),
            },
          },
          {
            new: true,
            runValidators: true,
            session: mockSession,
          },
        );

      expect(mockFlightModel.findOneAndUpdate)
        .toHaveBeenCalledTimes(1);

      expect(mockBookingModel.findOneAndUpdate)
        .toHaveBeenCalledTimes(1);

      expect(mockSession.withTransaction)
        .toHaveBeenCalledTimes(1);

      expect(mockSession.endSession)
        .toHaveBeenCalledTimes(1);
    });
  });

  describe('create', () => {
    const flightId = '507f1f77bcf86cd799439012';

    const bookingDto: CreateBookingDto = {
      flightId,
      userId: 'test-user-001',
      cabinClass: CabinClass.ECONOMY,
      passengers: [
        {
          firstName: 'Ahmed',
          lastName: 'Mohamed',
          passportNumber: 'TEST123456',
        },
        {
          firstName: 'Omar',
          lastName: 'Hassan',
          passportNumber: 'TEST654321',
        },
      ],
    };

    const makeFlight = (availableSeats: number) => ({
      _id: flightId,
      status: FlightStatus.SCHEDULED,
      departureTimeUtc: new Date('2030-12-01T10:00:00Z'),
      cabins: [
        {
          cabinClass: CabinClass.ECONOMY,
          price: 2500,
          totalSeats: 100,
          availableSeats,
        },
      ],
    });

    it('should reject a flight that does not exist', async () => {
      mockFlightModel.findById.mockReturnValue({
        exec: jest.fn<() => Promise<null>>()
          .mockResolvedValue(null),
      });

      await expect(
        service.create(bookingDto),
      ).rejects.toThrow(NotFoundException);

      expect(mockBookingModel.db.startSession)
        .not.toHaveBeenCalled();
    });

    it('should reject a booking with insufficient seats', async () => {
      const flight = makeFlight(1);

      mockFlightModel.findById.mockReturnValue({
        exec: jest.fn<
          () => Promise<typeof flight>
        >().mockResolvedValue(flight),
      });

      await expect(
        service.create(bookingDto),
      ).rejects.toThrow(
        'Not enough available seats',
      );

      expect(mockBookingModel.db.startSession)
        .not.toHaveBeenCalled();
    });

    it('should reserve 2 seats and calculate the total price', async () => {
      const flight = makeFlight(100);
      const reservedFlight = makeFlight(98);

      const createdBooking = {
        _id: '507f1f77bcf86cd799439013',
        flightId,
        userId: bookingDto.userId,
        cabinClass: bookingDto.cabinClass,
        passengers: bookingDto.passengers,
        totalPrice: 5000,
        status: BookingStatus.PENDING,
      };

      const mockSession = {
        withTransaction: jest.fn<
          (callback: () => Promise<void>) => Promise<void>
        >().mockImplementation(async (callback) => {
          await callback();
        }),
        endSession: jest.fn<
          () => Promise<void>
        >().mockResolvedValue(undefined),
      };

      mockFlightModel.findById.mockReturnValue({
        exec: jest.fn<
          () => Promise<typeof flight>
        >().mockResolvedValue(flight),
      });

      mockBookingModel.db.startSession.mockReturnValue(
        mockSession,
      );

      mockFlightModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn<
          () => Promise<typeof reservedFlight>
        >().mockResolvedValue(reservedFlight),
      });

      const createResult = jest.fn<
        () => Promise<typeof createdBooking[]>
      >().mockResolvedValue([createdBooking]);

      mockBookingModel.create.mockImplementation(createResult);

      const result = await service.create(bookingDto);

      expect(result).toEqual(createdBooking);

      expect(mockFlightModel.findOneAndUpdate)
        .toHaveBeenCalledWith(
          expect.objectContaining({
            status: FlightStatus.SCHEDULED,
          }),
          {
            $inc: {
              'cabins.$.availableSeats': -2,
            },
          },
          {
            new: true,
            session: mockSession,
          },
        );

      expect(mockBookingModel.create)
        .toHaveBeenCalledWith(
          [
            expect.objectContaining({
              totalPrice: 5000,
              status: BookingStatus.PENDING,
              passengers: bookingDto.passengers,
            }),
          ],
          {
            session: mockSession,
          },
        );

      expect(mockSession.withTransaction)
        .toHaveBeenCalledTimes(1);

      expect(mockSession.endSession)
        .toHaveBeenCalledTimes(1);
    });
  });

  describe('findOne', () => {
    const bookingId = '507f1f77bcf86cd799439011';
    const userId = 'test-user-001';

    it('should reject an invalid booking ID', async () => {
      await expect(
        service.findOne('invalid-id', userId),
      ).rejects.toThrow(BadRequestException);

      expect(mockBookingModel.findOne)
        .not.toHaveBeenCalled();
    });

    it('should return a booking belonging to the user', async () => {
      const booking = {
        _id: bookingId,
        userId,
        status: BookingStatus.CONFIRMED,
        totalPrice: 5000,
      };

      mockBookingModel.findOne.mockReturnValue({
        exec: jest.fn<() => Promise<typeof booking>>()
          .mockResolvedValue(booking),
      });

      const result = await service.findOne(
        bookingId,
        userId,
      );

      expect(result).toEqual(booking);

      expect(mockBookingModel.findOne)
        .toHaveBeenCalledWith({
          _id: bookingId,
          userId,
        });
    });

    it('should not return another user booking', async () => {
      mockBookingModel.findOne.mockReturnValue({
        exec: jest.fn<() => Promise<null>>()
          .mockResolvedValue(null),
      });

      await expect(
        service.findOne(bookingId, 'different-user'),
      ).rejects.toThrow(NotFoundException);

      expect(mockBookingModel.findOne)
        .toHaveBeenCalledWith({
          _id: bookingId,
          userId: 'different-user',
        });
    });
  });

  describe('findByUser', () => {
    it('should reject an empty user ID', async () => {
      await expect(
        service.findByUser(''),
      ).rejects.toThrow(BadRequestException);

      expect(mockBookingModel.find)
        .not.toHaveBeenCalled();
    });

    it('should return user booking history newest first', async () => {
      const userId = 'test-user-001';

      const bookings = [
        {
          _id: '507f1f77bcf86cd799439013',
          userId,
          status: BookingStatus.CONFIRMED,
          createdAt: new Date('2026-11-10'),
        },
        {
          _id: '507f1f77bcf86cd799439011',
          userId,
          status: BookingStatus.CANCELLED,
          createdAt: new Date('2026-11-01'),
        },
      ];

      const exec = jest.fn<
        () => Promise<typeof bookings>
      >().mockResolvedValue(bookings);

      const sort = jest.fn().mockReturnValue({ exec });

      mockBookingModel.find.mockReturnValue({ sort });

      const result = await service.findByUser(userId);

      expect(result).toEqual(bookings);

      expect(mockBookingModel.find)
        .toHaveBeenCalledWith({ userId });

      expect(sort)
        .toHaveBeenCalledWith({ createdAt: -1 });
    });
  });

});
