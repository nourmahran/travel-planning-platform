import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from './schemas/user.schema';
import { RefreshSession } from './schemas/refresh-session.schema';
import { AuthCookieService } from './cookies/auth-cookie.service';
import { AccountStatus } from './constants/account-status';
import { UserRole } from './constants/roles';

describe('AuthService', () => {
  let service: AuthService;

  const mockUserModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  };

  const mockRefreshSessionModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('access.jwt.token'),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret-at-least-32-characters';
      if (key === 'NODE_ENV') return 'test';
      return undefined;
    }),
  };

  const mockCookieService = {
    setAuthCookies: jest.fn(),
    clearAuthCookies: jest.fn(),
  };

  const mockResponse = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as never;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: getModelToken(RefreshSession.name),
          useValue: mockRefreshSessionModel,
        },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuthCookieService, useValue: mockCookieService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should register a new user successfully', async () => {
    const registerDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'TestPass123!',
      acceptedTerms: true,
      acceptedPrivacyPolicy: true,
    };

    mockUserModel.findOne.mockResolvedValue(null);
    mockUserModel.create.mockImplementation(async (data) => ({
      _id: { toString: () => '123456' },
      ...data,
    }));

    const result = await service.register(registerDto);

    expect(result.message).toBe('Registration successful');
    expect(result.user).toEqual({
      id: '123456',
      name: 'Test User',
      email: 'test@example.com',
      role: UserRole.USER,
    });

    const savedUser = mockUserModel.create.mock.calls[0][0];
    expect(savedUser.passwordHash).toBeDefined();
    expect(savedUser.passwordHash).not.toBe('TestPass123!');
    expect(await bcrypt.compare('TestPass123!', savedUser.passwordHash)).toBe(
      true,
    );
    expect(result.user).not.toHaveProperty('password');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('should reject registration with an existing email', async () => {
    mockUserModel.findOne.mockResolvedValue({
      _id: 'existing-user-id',
      email: 'test@example.com',
    });

    await expect(
      service.register({
        name: 'Test User',
        email: 'test@example.com',
        password: 'TestPass123!',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
      }),
    ).rejects.toThrow(ConflictException);

    expect(mockUserModel.create).not.toHaveBeenCalled();
  });

  it('should login successfully and set cookies', async () => {
    const passwordHash = await bcrypt.hash('TestPass123!', 12);
    const user = {
      _id: { toString: () => 'user-1' },
      name: 'Test User',
      email: 'test@example.com',
      role: UserRole.USER,
      status: AccountStatus.ACTIVE,
      passwordHash,
      failedLoginAttempts: 2,
      lockUntil: null,
      mustChangePassword: false,
      phone: null,
      preferredCurrency: 'USD',
      providerType: null,
      providerId: null,
      save: jest.fn().mockResolvedValue(undefined),
    };

    mockUserModel.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });
    mockRefreshSessionModel.create.mockResolvedValue({
      _id: { toString: () => 'session-1' },
    });

    const result = await service.login(
      { email: 'test@example.com', password: 'TestPass123!' },
      mockResponse,
    );

    expect(result.message).toBe('Login successful');
    expect(result.user.email).toBe('test@example.com');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(user.failedLoginAttempts).toBe(0);
    expect(mockCookieService.setAuthCookies).toHaveBeenCalledTimes(1);
  });

  it('should reject invalid credentials with a generic error', async () => {
    const passwordHash = await bcrypt.hash('TestPass123!', 12);
    const user = {
      _id: { toString: () => 'user-1' },
      email: 'test@example.com',
      status: AccountStatus.ACTIVE,
      passwordHash,
      failedLoginAttempts: 0,
      lockUntil: null,
      save: jest.fn().mockResolvedValue(undefined),
    };

    mockUserModel.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });

    await expect(
      service.login(
        { email: 'test@example.com', password: 'WrongPass123!' },
        mockResponse,
      ),
    ).rejects.toThrow('Invalid email or password');

    expect(user.failedLoginAttempts).toBe(1);
    expect(mockCookieService.setAuthCookies).not.toHaveBeenCalled();
  });

  it('should reject suspended accounts', async () => {
    mockUserModel.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        email: 'test@example.com',
        status: AccountStatus.SUSPENDED,
        passwordHash: 'hash',
        lockUntil: null,
      }),
    });

    await expect(
      service.login(
        { email: 'test@example.com', password: 'TestPass123!' },
        mockResponse,
      ),
    ).rejects.toThrow('Account is suspended');
  });

  it('should lock the account after five failed attempts', async () => {
    const passwordHash = await bcrypt.hash('TestPass123!', 12);
    const user = {
      _id: { toString: () => 'user-1' },
      email: 'test@example.com',
      status: AccountStatus.ACTIVE,
      passwordHash,
      failedLoginAttempts: 4,
      lockUntil: null as Date | null,
      save: jest.fn().mockResolvedValue(undefined),
    };

    mockUserModel.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });

    await expect(
      service.login(
        { email: 'test@example.com', password: 'WrongPass123!' },
        mockResponse,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(user.lockUntil).toBeInstanceOf(Date);
    expect(user.failedLoginAttempts).toBe(0);
  });

  it('should logout and revoke the refresh session', async () => {
    mockRefreshSessionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const result = await service.logout(
      {
        refresh_token: 'raw-refresh-token',
        access_token: 'raw-access',
        csrf_token: 'csrf-value',
      },
      { 'x-csrf-token': 'csrf-value' },
      mockResponse,
    );

    expect(result.message).toBe('Logout successful');
    expect(mockRefreshSessionModel.updateOne).toHaveBeenCalledTimes(1);
    expect(mockCookieService.clearAuthCookies).toHaveBeenCalledTimes(1);
  });

  it('should refresh a valid session and rotate cookies', async () => {
    const session = {
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      lastActivityAt: new Date(),
      revokedAt: null as Date | null,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const user = {
      _id: { toString: () => 'user-1' },
      name: 'Test User',
      email: 'test@example.com',
      role: UserRole.USER,
      status: AccountStatus.ACTIVE,
      mustChangePassword: false,
      phone: null,
      preferredCurrency: 'USD',
      providerType: null,
      providerId: null,
    };

    mockRefreshSessionModel.findOne.mockResolvedValue(session);
    mockUserModel.findById.mockResolvedValue(user);
    mockRefreshSessionModel.create.mockResolvedValue({
      _id: { toString: () => 'session-2' },
    });

    const result = await service.refresh(
      {
        refresh_token: 'raw-refresh-token',
        csrf_token: 'csrf-value',
      },
      { 'x-csrf-token': 'csrf-value' },
      mockResponse,
    );

    expect(result.message).toBe('Session refreshed');
    expect(session.revokedAt).toBeInstanceOf(Date);
    expect(mockCookieService.setAuthCookies).toHaveBeenCalledTimes(1);
  });
});
