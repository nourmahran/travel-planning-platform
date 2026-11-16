import { OptionalJwt, InternalHotelEndpoint } from '../shared/auth/optional-jwt.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { AuthUser } from '../shared/auth/auth-user';
import { AuthGuard, OptionalAuthGuard } from '../shared/auth/auth.guard';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Roles } from '../shared/auth/roles.decorator';
import { RolesGuard } from '../shared/auth/roles.guard';
import { ParseMongoIdPipe } from '../shared/pipes/parse-mongo-id.pipe';
import {
  AvailableRoomsQueryDto,
  BlockRoomDatesDto,
  CreateRoomDto,
  UpdateRoomBlockDto,
  UpdateRoomDto,
} from './dto/room.dto';
import {
  AvailableRoomsResponseDto,
  RoomAvailabilityBlockResponseDto,
  RoomResponseDto,
} from './dto/responses.dto';
import { RoomsService } from './rooms.service';

@ApiTags('Hotel rooms')
@Controller('api/hotels/:hotelId/rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiParam({ name: 'hotelId' })
  @ApiOperation({
    summary: 'HTL-03 Create an individually bookable room',
    description:
      'Each room document is one physical room with its own number, occupancy, bed configuration and nightly price (minor units of the platform currency).',
  })
  @ApiCreatedResponse({ type: RoomResponseDto })
  create(
    @Param('hotelId', ParseMongoIdPipe) hotelId: Types.ObjectId,
    @Body() dto: CreateRoomDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RoomResponseDto> {
    return this.rooms.create(hotelId, dto, user);
  }

  @Get()
  @OptionalJwt()
  @UseGuards(OptionalAuthGuard)
  @ApiParam({ name: 'hotelId' })
  @ApiOperation({
    summary: 'List rooms of a hotel',
    description:
      'Public callers see active rooms only. The assigned moderator and administrators also see inactive rooms.',
  })
  @ApiOkResponse({ type: RoomResponseDto, isArray: true })
  list(
    @Param('hotelId', ParseMongoIdPipe) hotelId: Types.ObjectId,
    @CurrentUser() user?: AuthUser,
  ): Promise<RoomResponseDto[]> {
    return this.rooms.list(hotelId, user);
  }

  @Get('available')
  @OptionalJwt()
  @UseGuards(OptionalAuthGuard)
  @ApiParam({ name: 'hotelId' })
  @ApiOperation({
    summary: 'HTL-15 Rooms available for the entire stay',
    description:
      'Returns active rooms with no blocked night and no reservation hold/booking for any night of the stay. Optional guests filter keeps only rooms whose capacity is sufficient.',
  })
  @ApiOkResponse({ type: AvailableRoomsResponseDto })
  available(
    @Param('hotelId', ParseMongoIdPipe) hotelId: Types.ObjectId,
    @Query() query: AvailableRoomsQueryDto,
    @CurrentUser() user?: AuthUser,
  ): Promise<AvailableRoomsResponseDto> {
    return this.rooms.available(hotelId, query, user);
  }

  @Patch(':roomId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-05 Update a room',
    description:
      'A capacity reduction (maxAdults/maxChildren) is rejected when an upcoming reservation no longer fits. Price changes are safe because reservations store a price snapshot.',
  })
  @ApiOkResponse({ type: RoomResponseDto })
  update(
    @Param('hotelId', ParseMongoIdPipe) hotelId: Types.ObjectId,
    @Param('roomId', ParseMongoIdPipe) roomId: Types.ObjectId,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RoomResponseDto> {
    return this.rooms.update(hotelId, roomId, dto, user);
  }

  @Delete(':roomId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-06 / HTL-07 Delete a room',
    description:
      'Deletion is blocked while the room has active or upcoming holds/reservations: deactivate it instead so existing bookings remain valid.',
  })
  @ApiOkResponse({ description: 'Room deleted.' })
  remove(
    @Param('hotelId', ParseMongoIdPipe) hotelId: Types.ObjectId,
    @Param('roomId', ParseMongoIdPipe) roomId: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<{ deleted: true; roomId: string }> {
    return this.rooms.remove(hotelId, roomId, user);
  }

  @Get(':roomId/availability')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List blocked date ranges of a room' })
  @ApiOkResponse({ type: RoomAvailabilityBlockResponseDto, isArray: true })
  listBlocks(
    @Param('hotelId', ParseMongoIdPipe) hotelId: Types.ObjectId,
    @Param('roomId', ParseMongoIdPipe) roomId: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<RoomAvailabilityBlockResponseDto[]> {
    return this.rooms.listBlocks(hotelId, roomId, user);
  }

  @Post(':roomId/availability')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-04 Block a room for a date range',
    description:
      'The range is inclusive. Overlapping reservations (holds or confirmed bookings) or other blocks are rejected; the block also takes the per-night lock so a concurrent booking cannot slip in.',
  })
  @ApiCreatedResponse({ type: RoomAvailabilityBlockResponseDto })
  blockDates(
    @Param('hotelId', ParseMongoIdPipe) hotelId: Types.ObjectId,
    @Param('roomId', ParseMongoIdPipe) roomId: Types.ObjectId,
    @Body() dto: BlockRoomDatesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RoomAvailabilityBlockResponseDto> {
    return this.rooms.blockDates(hotelId, roomId, dto, user);
  }

  @Patch(':roomId/availability/:blockId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-05 / HTL-06 Edit a blocked date range',
    description:
      'Moves the blocked range (and its per-night locks) after checking reservations and other blocks.',
  })
  @ApiOkResponse({ type: RoomAvailabilityBlockResponseDto })
  updateBlock(
    @Param('hotelId', ParseMongoIdPipe) hotelId: Types.ObjectId,
    @Param('roomId', ParseMongoIdPipe) roomId: Types.ObjectId,
    @Param('blockId', ParseMongoIdPipe) blockId: Types.ObjectId,
    @Body() dto: UpdateRoomBlockDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RoomAvailabilityBlockResponseDto> {
    return this.rooms.updateBlock(hotelId, roomId, blockId, dto, user);
  }

  @Delete(':roomId/availability/:blockId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'HTL-06 Remove a blocked date range' })
  @ApiOkResponse({ description: 'Blocked range deleted and its nights released.' })
  deleteBlock(
    @Param('hotelId', ParseMongoIdPipe) hotelId: Types.ObjectId,
    @Param('roomId', ParseMongoIdPipe) roomId: Types.ObjectId,
    @Param('blockId', ParseMongoIdPipe) blockId: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<{ deleted: true; blockId: string }> {
    return this.rooms.deleteBlock(hotelId, roomId, blockId, user);
  }
}
