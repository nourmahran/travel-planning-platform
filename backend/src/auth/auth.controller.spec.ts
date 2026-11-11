import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  // Test 1: Controller should exist
  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // Test 2: Successful registration
  it('should register a user successfully', async () => {
    const registerDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'TestPass123!',
      acceptedTerms: true,
      acceptedPrivacyPolicy: true,
    };

    const expectedResponse = {
      message: 'Registration successful',
      user: {
        id: '123456',
        name: 'Test User',
        email: 'test@example.com',
        role: 'user',
      },
    };

    mockAuthService.register.mockResolvedValue(expectedResponse);

    const result = await controller.register(registerDto);

    expect(mockAuthService.register).toHaveBeenCalledWith(registerDto);

    expect(mockAuthService.register).toHaveBeenCalledTimes(1);

    expect(result).toEqual(expectedResponse);

    expect(result.user).not.toHaveProperty('password');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  // Test 3: Duplicate email error
  it('should handle duplicate email errors', async () => {
    const registerDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'TestPass123!',
      acceptedTerms: true,
      acceptedPrivacyPolicy: true,
    };

    mockAuthService.register.mockRejectedValue(
      new ConflictException('Email is already registered'),
    );

    await expect(controller.register(registerDto)).rejects.toThrow(
      'Email is already registered',
    );

    expect(mockAuthService.register).toHaveBeenCalledTimes(1);
  });
});
import { jest } from '@jest/globals';
