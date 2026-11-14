import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model, Types } from 'mongoose';
import type { AuthUser } from '../shared/auth/auth-user';
import { PaginatedResult, paginate } from '../shared/dto/pagination-query.dto';
import { isDuplicateKeyError, runInTransaction } from '../shared/utils/transaction.util';
import {
  CreateReviewDto,
  HotelReviewsQueryDto,
  ReviewReplyDto,
  ReviewVisibilityDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { ReviewResponseDto } from './dto/responses.dto';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelsService } from './hotels.service';
import {
  HOTEL_NOTIFICATION_SERVICE,
  NotificationPort,
} from './integrations/notification.port';
import { toReviewResponse } from './mappers/response.mapper';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { HotelBooking, HotelBookingDocument, HotelBookingStatus } from './schemas/hotel-booking.schema';
import { Review, ReviewDocument } from './schemas/review.schema';

@Injectable()
export class ReviewsService implements OnModuleInit {
  constructor(
    @InjectModel(Review.name) private readonly reviewModel: Model<ReviewDocument>,
    @InjectModel(Hotel.name) private readonly hotelModel: Model<HotelDocument>,
    @InjectModel(HotelBooking.name)
    private readonly bookingModel: Model<HotelBookingDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly hotels: HotelsService,
    private readonly bookings: HotelBookingsService,
    @Inject(HOTEL_NOTIFICATION_SERVICE)
    private readonly notifications: NotificationPort,
  ) {}

  /** Wait for the unique one-review-per-booking index before serving requests. */
  async onModuleInit(): Promise<void> {
    await this.reviewModel.init();
  }

  // -------------------------------------------------------------------------
  // HTL-23: review an eligible completed reservation (one review per booking)
  // -------------------------------------------------------------------------

  async createForBooking(
    bookingId: Types.ObjectId,
    user: AuthUser,
    dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    const booking = await this.bookings.getBookingOrThrow(bookingId);

    if (booking.userId.toString() !== user.id) {
      throw new ForbiddenException('Only the guest of this reservation can review the stay.');
    }
    if (booking.status !== HotelBookingStatus.COMPLETED) {
      throw new ConflictException(
        'Only completed reservations can be reviewed. The reservation becomes COMPLETED after check-out.',
      );
    }

    const existing = await this.reviewModel.exists({ bookingId: booking._id });
    if (existing) {
      throw new ConflictException('This reservation has already been reviewed.');
    }

    let review: ReviewDocument | null = null;
    try {
      await runInTransaction(this.connection, async (session) => {
        const duplicate = await this.reviewModel
          .findOne({ bookingId: booking._id })
          .session(session)
          .lean();
        if (duplicate) {
          throw new ConflictException('This reservation has already been reviewed.');
        }

        const [created] = await this.reviewModel.create(
          [
            {
              hotelId: booking.hotelId,
              bookingId: booking._id,
              userId: booking.userId,
              rating: dto.rating,
              ...(dto.title ? { title: dto.title } : {}),
              comment: dto.comment,
              isHidden: false,
              isDeleted: false,
            },
          ],
          { session },
        );
        review = created;

        await this.bookingModel.updateOne(
          { _id: booking._id },
          { $set: { reviewId: created._id } },
          { session },
        );
        await this.recomputeHotelRating(booking.hotelId, session);
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('This reservation has already been reviewed.');
      }
      throw error;
    }

    if (!review) {
      throw new ConflictException('The review could not be created.');
    }

    // Recompute once more after the transaction commits. Two guests reviewing
    // concurrently could otherwise both aggregate a snapshot that misses the
    // other review and overwrite the hotel average with a partial count.
    await this.recomputeHotelRating(booking.hotelId);

    await this.notifyModerator(booking, review);

    return toReviewResponse(review);
  }

  // -------------------------------------------------------------------------
  // HTL-24: public reviews and hotel average rating
  // -------------------------------------------------------------------------

  async listForHotel(
    hotelId: Types.ObjectId,
    query: HotelReviewsQueryDto,
    viewer?: AuthUser,
  ): Promise<PaginatedResult<ReviewResponseDto>> {
    const hotel = await this.hotels.getHotelOrThrow(hotelId);
    const canManage = viewer ? this.hotels.canManage(viewer, hotel) : false;
    if (!hotel.isActive && !canManage) {
      throw new NotFoundException('Hotel not found.');
    }

    const filter: FilterQuery<ReviewDocument> = {
      hotelId: hotel._id,
      isDeleted: { $ne: true },
      ...(canManage ? {} : { isHidden: { $ne: true } }),
    };

    const sort: Record<string, 1 | -1> =
      query.sort === 'oldest'
        ? { createdAt: 1 }
        : query.sort === 'rating_desc'
          ? { rating: -1, createdAt: -1 }
          : query.sort === 'rating_asc'
            ? { rating: 1, createdAt: -1 }
            : { createdAt: -1 };

    const total = await this.reviewModel.countDocuments(filter).exec();
    const reviews = await this.reviewModel
      .find(filter)
      .sort(sort)
      .skip(query.skip)
      .limit(query.limit)
      .exec();

    return paginate(
      reviews.map(toReviewResponse),
      total,
      query.page,
      query.limit,
    );
  }

  // -------------------------------------------------------------------------
  // HTL-23: edit / delete your own review
  // -------------------------------------------------------------------------

  async update(
    reviewId: Types.ObjectId,
    user: AuthUser,
    dto: UpdateReviewDto,
  ): Promise<ReviewResponseDto> {
    const review = await this.getReviewOrThrow(reviewId);
    if (review.isDeleted) {
      throw new ConflictException('A deleted review cannot be edited.');
    }
    if (review.userId.toString() !== user.id) {
      throw new ForbiddenException('You can only edit your own review.');
    }
    if (dto.rating === undefined && dto.title === undefined && dto.comment === undefined) {
      throw new BadRequestException('Provide at least one field to update.');
    }

    const ratingChanged = dto.rating !== undefined && dto.rating !== review.rating;
    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.title !== undefined) review.title = dto.title;
    if (dto.comment !== undefined) review.comment = dto.comment;

    await review.save();
    if (ratingChanged) {
      await this.recomputeHotelRating(review.hotelId);
    }

    return toReviewResponse(review);
  }

  async remove(
    reviewId: Types.ObjectId,
    user: AuthUser,
  ): Promise<{ deleted: true; reviewId: string }> {
    const review = await this.getReviewOrThrow(reviewId);
    if (review.userId.toString() !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('You can only delete your own review.');
    }

    if (!review.isDeleted) {
      review.isDeleted = true;
      await review.save();
      await this.recomputeHotelRating(review.hotelId);
    }

    return { deleted: true, reviewId: review._id.toString() };
  }

  // -------------------------------------------------------------------------
  // HTL-26 (optional bonus): hotel moderator reply
  // -------------------------------------------------------------------------

  async reply(
    reviewId: Types.ObjectId,
    user: AuthUser,
    dto: ReviewReplyDto,
  ): Promise<ReviewResponseDto> {
    const review = await this.getReviewOrThrow(reviewId);
    if (review.isDeleted) {
      throw new ConflictException('A deleted review cannot be replied to.');
    }

    const hotel = await this.hotels.getHotelOrThrow(review.hotelId);
    this.hotels.assertCanManage(user, hotel);

    review.moderatorReply = {
      body: dto.body,
      repliedBy: new Types.ObjectId(user.id),
      repliedAt: new Date(),
    };
    await review.save();

    return toReviewResponse(review);
  }

  // -------------------------------------------------------------------------
  // Member 6 / administrator moderation
  // -------------------------------------------------------------------------

  async setVisibility(
    reviewId: Types.ObjectId,
    dto: ReviewVisibilityDto,
    user: AuthUser,
  ): Promise<ReviewResponseDto> {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Only an administrator can hide or restore a review.');
    }
    const review = await this.getReviewOrThrow(reviewId);

    review.isHidden = dto.hidden;
    review.hiddenReason = dto.hidden ? dto.reason ?? 'Hidden by moderation.' : null;
    await review.save();
    await this.recomputeHotelRating(review.hotelId);

    return toReviewResponse(review);
  }

  async recomputeHotelRating(
    hotelId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const pipeline = [
      {
        $match: {
          hotelId,
          isDeleted: { $ne: true },
          isHidden: { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          reviewCount: { $sum: 1 },
        },
      },
    ];

    const aggregate = this.reviewModel.aggregate<{
      averageRating: number;
      reviewCount: number;
    }>(pipeline);
    if (session) {
      aggregate.session(session);
    }
    const [stats] = await aggregate.exec();

    const update = this.hotelModel.updateOne(
      { _id: hotelId },
      {
        $set: {
          averageRating: stats ? Math.round(stats.averageRating * 100) / 100 : 0,
          reviewCount: stats?.reviewCount ?? 0,
        },
      },
    );
    if (session) {
      update.session(session);
    }
    await update.exec();
  }

  // -------------------------------------------------------------------------

  private async getReviewOrThrow(reviewId: Types.ObjectId): Promise<ReviewDocument> {
    const review = await this.reviewModel.findById(reviewId).exec();
    if (!review) {
      throw new NotFoundException('Review not found.');
    }
    return review;
  }

  private async notifyModerator(
    booking: HotelBookingDocument,
    review: ReviewDocument,
  ): Promise<void> {
    try {
      const hotel = await this.hotelModel.findById(booking.hotelId).exec();
      if (!hotel?.moderatorId) {
        return;
      }
      await this.notifications.send({
        userId: hotel.moderatorId.toString(),
        type: 'HOTEL_REVIEW_RECEIVED',
        title: 'New hotel review',
        message: `${booking.hotelName} received a ${review.rating}-star review.`,
        data: { reviewId: review._id.toString(), hotelId: hotel._id.toString() },
      });
    } catch {
      // Notifications must never fail a review submission.
    }
  }
}
