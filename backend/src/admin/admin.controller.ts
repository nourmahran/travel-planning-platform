import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/constants/roles';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AdminService } from './admin.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AuthService } from '../auth/auth.service';
import { AdminResetPasswordDto } from '../auth/dto/admin-reset-password.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ListAccountsDto } from './dto/list-accounts.dto';
import { ListAdminBookingsDto } from './dto/list-bookings.dto';

@ApiTags('Administration')
@ApiCookieAuth('access_token')
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly authService: AuthService,
  ) {}

  @Post('users/:id/reset-password')
  @ApiOperation({
    summary: 'ACC-07a Reset an account to a temporary password',
    description:
      'The admin sets a temporary password; the account must change it on its next login.',
  })
  @ApiOkResponse({ description: 'Temporary password issued.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  async resetPassword(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AdminResetPasswordDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    const result = await this.authService.adminResetPassword(
      id,
      dto.temporaryPassword,
    );
    await this.adminService.audit(admin.id, 'account.password_reset', 'account', id);
    return result;
  }

  @Post('moderators')
  @ApiOperation({
    summary: 'Create an airline or hotel moderator',
    description:
      'ACC-13: admin creates a moderator for exactly one provider with a temporary password.',
  })
  @ApiCreatedResponse({ description: 'Moderator created.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  async createModerator(
    @Body() dto: CreateModeratorDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    const result = await this.adminService.createModerator(dto);
    await this.adminService.audit(admin.id, 'moderator.create', 'account', result.user.id, {
      providerType: dto.providerType,
      providerId: dto.providerId,
    });
    return result;
  }

  @Get('accounts')
  @ApiOperation({
    summary: 'List accounts',
    description:
      'ACC-14: search, role, status, registration date, 10 per page.',
  })
  @ApiOkResponse({ description: 'Paginated account list.' })
  listAccounts(@Query() query: ListAccountsDto) {
    return this.adminService.listAccounts(query);
  }

  @Patch('accounts/:id/suspend')
  @ApiOperation({
    summary: 'Suspend a user or moderator account',
    description: 'ACC-15 / ACC-16: suspended accounts cannot log in.',
  })
  @ApiOkResponse({ description: 'Account suspended.' })
  @ApiNotFoundResponse({ description: 'Account not found.' })
  async suspendAccount(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    const result = await this.adminService.suspendAccount(id);
    await this.adminService.audit(admin.id, 'account.suspend', 'account', id);
    return result;
  }

  @Patch('accounts/:id/reactivate')
  @ApiOperation({
    summary: 'Reactivate a suspended user or moderator account',
  })
  @ApiOkResponse({ description: 'Account reactivated.' })
  async reactivateAccount(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    const result = await this.adminService.reactivateAccount(id);
    await this.adminService.audit(admin.id, 'account.reactivate', 'account', id);
    return result;
  }

  @Patch('providers/:type/:id/deactivate')
  @ApiOperation({
    summary: 'Deactivate an airline or hotel provider',
    description:
      'ACC-15: hides listings and blocks new bookings; Confirmed bookings remain valid.',
  })
  @ApiOkResponse({ description: 'Provider deactivated.' })
  @ApiBadRequestResponse({ description: 'Invalid provider type or id.' })
  async deactivateProvider(
    @Param('type') type: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    const providerType = this.parseProviderType(type);
    const result = await this.adminService.setProviderActive(providerType, id, false);
    await this.adminService.audit(admin.id, 'provider.deactivate', providerType, id);
    return result;
  }

  @Patch('providers/:type/:id/reactivate')
  @ApiOperation({
    summary: 'Reactivate an airline or hotel provider',
  })
  @ApiOkResponse({ description: 'Provider reactivated.' })
  async reactivateProvider(
    @Param('type') type: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    const providerType = this.parseProviderType(type);
    const result = await this.adminService.setProviderActive(providerType, id, true);
    await this.adminService.audit(admin.id, 'provider.reactivate', providerType, id);
    return result;
  }

  @Get('bookings')
  @ApiOperation({
    summary: 'Inspect flight and hotel bookings',
    description:
      'ACC-17: admin read-only booking list filtered by type, status, and date.',
  })
  @ApiOkResponse({ description: 'Paginated booking list.' })
  listBookings(@Query() query: ListAdminBookingsDto) {
    return this.adminService.listBookings(query);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'BON-01 Bookings and net revenue per provider over a selected period' })
  analytics(@Query('from') from: string, @Query('to') to: string) {
    return this.adminService.analytics(from, to);
  }

  private parseProviderType(type: string): 'airline' | 'hotel' {
    if (type !== 'airline' && type !== 'hotel') {
      throw new BadRequestException('Provider type must be airline or hotel');
    }
    return type;
  }
}
