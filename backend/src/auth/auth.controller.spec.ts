import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refresh: jest.fn(),
    me: jest.fn(),
    changePassword: jest.fn(),
    adminResetPassword: jest.fn(),
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

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

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
    expect(result).toEqual(expectedResponse);
    expect(result.user).not.toHaveProperty('password');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

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
  });

  it('should login a user successfully', async () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'TestPass123!',
    };
    const response = { cookie: jest.fn() } as never;
    const expected = {
      message: 'Login successful',
      user: {
        id: '123456',
        email: 'test@example.com',
        role: 'user',
      },
    };

    mockAuthService.login.mockResolvedValue(expected);

    const result = await controller.login(loginDto, response);

    expect(mockAuthService.login).toHaveBeenCalledWith(loginDto, response);
    expect(result).toEqual(expected);
  });

  it('should surface invalid login errors', async () => {
    mockAuthService.login.mockRejectedValue(
      new UnauthorizedException('Invalid email or password'),
    );

    await expect(
      controller.login(
        { email: 'test@example.com', password: 'WrongPass123!' },
        {} as never,
      ),
    ).rejects.toThrow('Invalid email or password');
  });

  it('should return the current user', async () => {
    mockAuthService.me.mockResolvedValue({
      user: { id: '123456', email: 'test@example.com', role: 'user' },
    });

    const result = await controller.me({
      id: '123456',
      email: 'test@example.com',
      name: 'Test',
      role: 'user' as never,
      mustChangePassword: false,
      providerType: null,
      providerId: null,
      sessionId: 'session-1',
    });

    expect(mockAuthService.me).toHaveBeenCalledWith('123456');
    expect(result.user.id).toBe('123456');
  });
});
