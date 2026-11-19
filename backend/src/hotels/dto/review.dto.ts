import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';
import { REVIEW_COMMENT_MAX_LENGTH, REVIEW_COMMENT_MIN_LENGTH } from '../schemas/review.schema';

/** HTL-23 */
export class CreateReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  /** HTL-23: the written review is optional; the rating is required. */
  @IsOptional()
  @IsString()
  @MinLength(REVIEW_COMMENT_MIN_LENGTH, {
    message: `comment must be at least ${REVIEW_COMMENT_MIN_LENGTH} characters long.`,
  })
  @MaxLength(REVIEW_COMMENT_MAX_LENGTH, {
    message: `comment cannot exceed ${REVIEW_COMMENT_MAX_LENGTH} characters.`,
  })
  comment?: string;
}

export class UpdateReviewDto extends PartialType(CreateReviewDto) {}

/** HTL-26 (optional bonus). */
export class ReviewReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body: string;
}

export const REVIEW_SORTS = ['newest', 'oldest', 'rating_desc', 'rating_asc'] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export class HotelReviewsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(REVIEW_SORTS)
  sort: ReviewSort = 'newest';
}

/** Used by Member 6's moderation endpoints. */
export class ReviewVisibilityDto {
  @IsBoolean()
  hidden: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
