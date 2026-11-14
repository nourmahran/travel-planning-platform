import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ConflictException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { User } from '../auth/schemas/user.schema';
import { RefreshSession } from '../auth/schemas/refresh-session.schema';
import { Airline } from '../airlines/schemas/airline.schema';
import { AccountStatus } from '../auth/constants/account-status';
import { UserRole } from '../auth/constants/roles';

describe('AdminService', () => {
  let service: AdminService;

  const mockUserModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    countDocuments: jest.fn(),
    find: jest.fn(),
  };

  const mockRefreshSessionModel = {
    updateMany: jest.fn(),
  };

  const mockAirlineModel = {
    findById: jest.fn(),
  };

  const mockConnection = {
    db: {
      collection: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: getModelToken(RefreshSession.name),
          useValue: mockRefreshSessionModel,
        },
        { provide: getModelToken(Airline.name), useValue: mockAirlineModel },
        { provide: getConnectionToken(), useValue: mockConnection },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create an airline moderator', async () => {
    mockUserModel.findOne.mockResolvedValue(null);
    mockAirlineModel.findById.mockResolvedValue({
      _id: 'airline-1',
      isActive: true,
    });
    mockUserModel.create.mockImplementation(async (data) => ({
      _id: { toString: () => 'mod-1' },
      phone: null,
      preferredCurrency: 'USD',
      providerId: data.providerId,
      ...data,
    }));

    const result = await service.createModerator({
      name: 'Mod User',
      email: 'mod@airline.com',
      temporaryPassword: 'TempPass123!',
      providerType: 'airline',
      providerId: '507f1f77bcf86cd799439011',
    });

    expect(result.user.role).toBe(UserRole.AIRLINE_MODERATOR);
    expect(result.user.mustChangePassword).toBe(true);
    expect(result.temporaryPassword).toBe('TempPass123!');
  });

  it('should reject duplicate moderator emails', async () => {
    mockUserModel.findOne.mockResolvedValue({ email: 'mod@airline.com' });

    await expect(
      service.createModerator({
        name: 'Mod User',
        email: 'mod@airline.com',
        temporaryPassword: 'TempPass123!',
        providerType: 'airline',
        providerId: '507f1f77bcf86cd799439011',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should suspend a user account', async () => {
    const user = {
      _id: { toString: () => 'user-1' },
      name: 'Test',
      email: 'test@example.com',
      role: UserRole.USER,
      status: AccountStatus.ACTIVE,
      phone: null,
      preferredCurrency: 'USD',
      mustChangePassword: false,
      providerType: null,
      providerId: null,
      save: jest.fn().mockResolvedValue(undefined),
    };

    mockUserModel.findById.mockResolvedValue(user);
    mockRefreshSessionModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const result = await service.suspendAccount('507f1f77bcf86cd799439011');

    expect(user.status).toBe(AccountStatus.SUSPENDED);
    expect(result.message).toContain('suspended');
  });

  it('should list accounts with pagination metadata', async () => {
    mockUserModel.countDocuments.mockResolvedValue(1);
    mockUserModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                _id: { toString: () => 'user-1' },
                name: 'Test',
                email: 'test@example.com',
                role: UserRole.USER,
                status: AccountStatus.ACTIVE,
                phone: null,
                preferredCurrency: 'USD',
                mustChangePassword: false,
                providerType: null,
                providerId: null,
              },
            ]),
          }),
        }),
      }),
    });

    const result = await service.listAccounts({ page: 1, limit: 10 });

    expect(result.total).toBe(1);
    expect(result.accounts).toHaveLength(1);
    expect(result.limit).toBe(10);
  });
});
