import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  ForbiddenException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/constants/roles';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AirlinesService } from './airlines.service';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlinesService: AirlinesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create an airline' })
  create(@Body() dto: CreateAirlineDto) {
    return this.airlinesService.create(dto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'List airlines' })
  findAll() {
    return this.airlinesService.findAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get airline details' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.airlinesService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.AIRLINE_MODERATOR)
  @ApiOperation({ summary: 'Update airline details' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAirlineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (user.role === UserRole.AIRLINE_MODERATOR && id !== user.providerId)
      throw new ForbiddenException('Airline belongs to another provider');
    return this.airlinesService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate an airline' })
  deactivate(@Param('id', ParseObjectIdPipe) id: string) {
    return this.airlinesService.remove(id);
  }
}
