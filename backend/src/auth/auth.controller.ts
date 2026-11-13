import { Body, Controller, Post } from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a user account after validating the email, password, and required consent.',
  })
  @ApiCreatedResponse({
    description: 'User registered successfully.',
    schema: {
      example: {
        message: 'Registration successful',
        user: {
          id: '507f1f77bcf86cd799439011',
          name: 'Test User',
          email: 'test@example.com',
          role: 'user',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid registration data or missing consent.',
  })
  @ApiConflictResponse({
    description: 'Email is already registered.',
  })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }
}
