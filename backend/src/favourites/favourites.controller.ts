import { Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/constants/roles';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { FavouritesService } from './favourites.service';

@ApiTags('Favourites')
@ApiCookieAuth('access_token')
@Roles(UserRole.USER)
@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Get()
  @ApiOperation({ summary: 'BON-02 List saved hotels and public itineraries' })
  list(@CurrentUser() user: AuthenticatedUser, @Query('page', new ParseIntPipe({ optional: true })) page?: number) {
    return this.favourites.list(user.id, page ?? 1);
  }

  @Post(':type/:id')
  @ApiOperation({ summary: 'BON-02 Save a hotel or public itinerary' })
  add(@CurrentUser() user: AuthenticatedUser, @Param('type') type: string, @Param('id') id: string) {
    return this.favourites.add(user.id, type, id);
  }

  @Delete(':type/:id')
  @ApiOperation({ summary: 'BON-02 Remove a saved hotel or itinerary' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('type') type: string, @Param('id') id: string) {
    return this.favourites.remove(user.id, type, id);
  }
}
