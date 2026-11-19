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
  HotelReviewsQueryDto,
  ReviewReplyDto,
  ReviewVisibilityDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { ReviewResponseDto } from './dto/responses.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('Hotel reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Patch(':id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-23 Edit your review',
    description:
      'Only the author can edit. Changing the rating recalculates the hotel average.',
  })
  @ApiOkResponse({ type: ReviewResponseDto })
  update(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateReviewDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReviewResponseDto> {
    return this.reviews.update(id, user, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-23 Delete your review',
    description:
      'Soft deletion: the review disappears from the hotel and averages but the completed reservation stays linked, so it cannot be reviewed twice.',
  })
  @ApiOkResponse({ description: 'Review deleted.' })
  remove(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<{ deleted: true; reviewId: string }> {
    return this.reviews.remove(id, user);
  }

  @Post(':id/reply')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('HOTEL_MODERATOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'HTL-26 Reply to a review as the hotel (optional bonus)',
    description: 'Only the moderator assigned to the reviewed hotel or an administrator.',
  })
  @ApiOkResponse({ type: ReviewResponseDto })
  reply(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Body() dto: ReviewReplyDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReviewResponseDto> {
    return this.reviews.reply(id, user, dto);
  }

  @Patch(':id/visibility')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Moderate a review (Member 6 integration)',
    description:
      'Administrators hide or restore a review; hidden reviews are excluded from the hotel average and the public list.',
  })
  @ApiOkResponse({ type: ReviewResponseDto })
  setVisibility(
    @Param('id', ParseMongoIdPipe) id: Types.ObjectId,
    @Body() dto: ReviewVisibilityDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReviewResponseDto> {
    return this.reviews.setVisibility(id, dto, user);
  }
}

@ApiTags('Hotel reviews')
@Controller('hotels/:hotelId/reviews')
export class HotelReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @OptionalJwt()
  @UseGuards(OptionalAuthGuard)
  @ApiParam({ name: 'hotelId' })
  @ApiOperation({
    summary: 'HTL-24 Hotel reviews',
    description:
      'Public paginated reviews (hidden/deleted ones are excluded). The assigned moderator and administrators also see hidden reviews.',
  })
  @ApiOkResponse({
    description: 'Paginated list: { items: ReviewResponseDto[], page, limit, total, totalPages }',
  })
  list(
    @Param('hotelId', ParseMongoIdPipe) hotelId: Types.ObjectId,
    @Query() query: HotelReviewsQueryDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.reviews.listForHotel(hotelId, query, user);
  }
}
