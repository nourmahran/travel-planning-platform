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
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ListAccountsDto } from './dto/list-accounts.dto';
import { ListAdminBookingsDto } from './dto/list-bookings.dto';

@ApiTags('Administration')
@ApiCookieAuth('access_token')
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('moderators')
  @ApiOperation({
    summary: 'Create an airline or hotel moderator',
    description:
      'ACC-13: admin creates a moderator for exactly one provider with a temporary password.',
  })
  @ApiCreatedResponse({ description: 'Moderator created.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  createModerator(@Body() dto: CreateModeratorDto) {
    return this.adminService.createModerator(dto);
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
  suspendAccount(@Param('id', ParseObjectIdPipe) id: string) {
    return this.adminService.suspendAccount(id);
  }

  @Patch('accounts/:id/reactivate')
  @ApiOperation({
    summary: 'Reactivate a suspended user or moderator account',
  })
  @ApiOkResponse({ description: 'Account reactivated.' })
  reactivateAccount(@Param('id', ParseObjectIdPipe) id: string) {
    return this.adminService.reactivateAccount(id);
  }

  @Patch('providers/:type/:id/deactivate')
  @ApiOperation({
    summary: 'Deactivate an airline or hotel provider',
    description:
      'ACC-15: hides listings and blocks new bookings; Confirmed bookings remain valid.',
  })
  @ApiOkResponse({ description: 'Provider deactivated.' })
  @ApiBadRequestResponse({ description: 'Invalid provider type or id.' })
  deactivateProvider(
    @Param('type') type: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const providerType = this.parseProviderType(type);
    return this.adminService.setProviderActive(providerType, id, false);
  }

  @Patch('providers/:type/:id/reactivate')
  @ApiOperation({
    summary: 'Reactivate an airline or hotel provider',
  })
  @ApiOkResponse({ description: 'Provider reactivated.' })
  reactivateProvider(
    @Param('type') type: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const providerType = this.parseProviderType(type);
    return this.adminService.setProviderActive(providerType, id, true);
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

  private parseProviderType(type: string): 'airline' | 'hotel' {
    if (type !== 'airline' && type !== 'hotel') {
      throw new BadRequestException('Provider type must be airline or hotel');
    }
    return type;
  }
}
