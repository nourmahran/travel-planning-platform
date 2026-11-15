import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { UserRole } from './constants/roles';
import type { AuthenticatedUser } from './types/authenticated-user';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';

@ApiTags('Authentication')
@ApiCookieAuth('access_token')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
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

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Authenticates a user, moderator, or administrator. Sets HTTP-only access and refresh cookies.',
  })
  @ApiOkResponse({
    description: 'Login successful. Auth cookies are set.',
    schema: {
      example: {
        message: 'Login successful',
        user: {
          id: '507f1f77bcf86cd799439011',
          name: 'Test User',
          email: 'test@example.com',
          role: 'user',
          status: 'active',
          mustChangePassword: false,
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials, suspended, deactivated, or locked.',
  })
  login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.login(loginDto, response);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log out',
    description:
      'Clears authentication cookies and revokes the refresh session on the server.',
  })
  @ApiOkResponse({
    description: 'Logout successful.',
    schema: { example: { message: 'Logout successful' } },
  })
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.logout(
      (request.cookies ?? {}) as Record<string, string | undefined>,
      request.headers as Record<string, string | string[] | undefined>,
      response,
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Refresh the access session',
    description:
      'Exchanges a valid refresh cookie for new HTTP-only auth cookies. The previous refresh token is revoked.',
  })
  @ApiOkResponse({
    description: 'Session refreshed. New auth cookies are set.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, revoked, inactive, or invalid refresh session.',
  })
  refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.refresh(
      (request.cookies ?? {}) as Record<string, string | undefined>,
      request.headers as Record<string, string | string[] | undefined>,
      response,
    );
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get the current authenticated user',
    description: 'Reads the access-token cookie and returns the account.',
  })
  @ApiOkResponse({ description: 'Current user profile.' })
  @ApiUnauthorizedResponse({ description: 'Not logged in or session expired.' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }

  @Patch('change-password')
  @ApiOperation({
    summary: 'Change password',
    description:
      'Logged-in user confirms the current password and sets a new one.',
  })
  @ApiOkResponse({
    description: 'Password changed.',
    schema: { example: { message: 'Password changed successfully' } },
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in or current password incorrect.',
  })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user, dto);
  }

  @Post('admin/users/:id/reset-password')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin reset password to a temporary password',
    description:
      'ACC-07a: admin sets a temporary password; the account must change it on next login.',
  })
  @ApiOkResponse({ description: 'Temporary password issued.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  adminResetPassword(
    @Param('id') id: string,
    @Body() dto: AdminResetPasswordDto,
  ) {
    return this.authService.adminResetPassword(id, dto.temporaryPassword);
  }
}
