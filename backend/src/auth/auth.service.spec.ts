import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { User } from './schemas/user.schema';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;

  const mockUserModel = {
    findOne: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // Test 1: Check that AuthService exists
  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Test 2: Successful registration
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
      _id: '123456',
      ...data,
    }));

    const result = await service.register(registerDto);

    expect(result.message).toBe('Registration successful');

    expect(result.user).toEqual({
      id: '123456',
      name: 'Test User',
      email: 'test@example.com',
      role: 'user',
    });

    expect(mockUserModel.create).toHaveBeenCalledTimes(1);

    const savedUser = mockUserModel.create.mock.calls[0][0];

    expect(savedUser.passwordHash).toBeDefined();
    expect(savedUser.passwordHash).not.toBe('TestPass123!');

    expect(
      await bcrypt.compare('TestPass123!', savedUser.passwordHash),
    ).toBe(true);

    expect(result.user).not.toHaveProperty('password');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  // Test 3: Duplicate email prevention
  it('should reject registration with an existing email', async () => {
    const registerDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'TestPass123!',
      acceptedTerms: true,
      acceptedPrivacyPolicy: true,
    };

    mockUserModel.findOne.mockResolvedValue({
      _id: 'existing-user-id',
      email: 'test@example.com',
    });

    await expect(service.register(registerDto)).rejects.toThrow(
      'Email is already registered',
    );

    expect(mockUserModel.create).not.toHaveBeenCalled();
  });
});