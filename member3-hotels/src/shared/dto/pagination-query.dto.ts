import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants';

/** GEN-05: lists are paginated, 10 records per page by default. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based).', minimum: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'page must be an integer.' })
  @Min(1, { message: 'page must be at least 1.' })
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Records per page. Defaults to 10 (GEN-05).',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'limit must be an integer.' })
  @Min(1, { message: 'limit must be at least 1.' })
  @Max(MAX_PAGE_SIZE, { message: `limit cannot exceed ${MAX_PAGE_SIZE}.` })
  limit: number = DEFAULT_PAGE_SIZE;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, page: number, limit: number): PaginatedResult<T> {
  return {
    items,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}
