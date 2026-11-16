import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ContentType,
  ModerationAction,
  PostStatus,
  ReportStatus,
} from '../types';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const tags = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((tag: unknown) =>
        typeof tag === 'string' ? tag.trim().toLowerCase() : tag,
      )
    : value;
const provided = (_object: unknown, value: unknown) => value !== undefined;

export class PageDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;
}

export class CreatePostDto {
  @ApiProperty({ example: 'A weekend in Aswan', maxLength: 300 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  @ApiProperty({
    example: 'We spent the morning exploring the Nile.',
    maxLength: 100000,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  body!: string;

  @ApiPropertyOptional({ enum: PostStatus, default: PostStatus.Draft })
  @ValidateIf(provided)
  @IsEnum(PostStatus)
  status?: PostStatus;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 5,
    example: ['egypt', 'aswan'],
  })
  @ValidateIf(provided)
  @Transform(tags)
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}

export class UpdatePostDto extends PartialType(CreatePostDto, {
  skipNullProperties: false,
}) {}

export class SearchPostsDto extends PageDto {
  @ApiPropertyOptional({ description: 'Keyword in title, tags or author name' })
  @ValidateIf(provided)
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Exact tag, ignoring case' })
  @ValidateIf(provided)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  tag?: string;
}

export class MinePostsDto extends PageDto {
  @ApiPropertyOptional({ enum: PostStatus })
  @ValidateIf(provided)
  @IsEnum(PostStatus)
  status?: PostStatus;
}

export class TagParamDto {
  @ApiProperty({ maxLength: 30 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  tag!: string;
}

export class CommentDto {
  @ApiProperty({ example: 'This was helpful!', maxLength: 500 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  body!: string;
}

export class ConfirmDto {
  @ApiProperty({
    enum: [true],
    description: 'Send true only after user confirmation',
  })
  @IsBoolean()
  @Equals(true)
  confirm!: boolean;
}

export class CreateReportDto {
  @ApiProperty({ enum: ContentType })
  @IsEnum(ContentType)
  targetType!: ContentType;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId()
  targetId!: string;

  @ApiProperty({ example: 'This contains harassment.', maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}

export class ReportsQueryDto extends PageDto {
  @ApiPropertyOptional({ enum: ReportStatus, default: ReportStatus.Open })
  @IsEnum(ReportStatus)
  status: ReportStatus = ReportStatus.Open;

  @ApiPropertyOptional({ enum: ContentType })
  @ValidateIf(provided)
  @IsEnum(ContentType)
  targetType?: ContentType;
}

export class ResolveReportDto {
  @ApiProperty({ enum: ModerationAction })
  @IsEnum(ModerationAction)
  action!: ModerationAction;

  @ApiPropertyOptional({ maxLength: 1000 })
  @ValidateIf(provided)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    enum: [true],
    description: 'Required for hide and delete',
  })
  @ValidateIf(
    (dto: ResolveReportDto) => dto.action !== ModerationAction.Dismiss,
  )
  @IsBoolean()
  @Equals(true)
  confirm?: boolean;
}

export class HideContentDto extends ConfirmDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @ValidateIf(provided)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AuthorQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  postsPage = 1;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  itinerariesPage = 1;
}

export class AuditQueryDto extends PageDto {
  @ApiPropertyOptional()
  @ValidateIf(provided)
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({ example: 'content.hidden' })
  @ValidateIf(provided)
  @IsString()
  @MaxLength(100)
  action?: string;
}
