import { Body, Controller, Delete, Get, Patch, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthCookieService } from '../auth/cookies/auth-cookie.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiCookieAuth('access_token')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my profile' })
  @ApiOkResponse({ description: 'Current user profile.' })
  @ApiUnauthorizedResponse({ description: 'Not logged in.' })
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update my profile',
    description: 'ACC-09: update name, phone, and preferred currency.',
  })
  @ApiOkResponse({ description: 'Profile updated.' })
  @ApiBadRequestResponse({ description: 'Invalid profile data.' })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateMe(user, dto);
  }

  @Delete('me')
  @ApiOperation({
    summary: 'Deactivate my account',
    description:
      'ACC-12: deactivate after confirmation when no upcoming Confirmed bookings exist.',
  })
  @ApiOkResponse({ description: 'Account deactivated.' })
  @ApiBadRequestResponse({
    description: 'Missing confirmation or upcoming confirmed bookings.',
  })
  async deactivateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeactivateAccountDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.usersService.deactivateMe(user, dto);
    this.authCookieService.clearAuthCookies(response);
    return result;
  }
}
