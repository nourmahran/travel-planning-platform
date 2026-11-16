import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { IMAGE_MIME_TYPES, ITINERARY_LIMITS } from '../itinerary.constants';
import type { ImageMimeType } from '../itinerary.constants';

export class AddImageDto {
  @ApiProperty({
    example: 'https://cdn.example.com/pyramids.png',
    description:
      'Image URL until Member 6 media upload exists; the media service will own the final storage.',
  })
  @IsUrl()
  @Length(1, 2048)
  url: string;

  @ApiProperty({
    enum: IMAGE_MIME_TYPES,
    example: 'image/png',
    description: 'GEN-08: JPG or PNG only.',
  })
  @IsString()
  @IsIn(IMAGE_MIME_TYPES)
  mimeType: ImageMimeType;

  @ApiProperty({
    example: 204800,
    minimum: 1,
    maximum: ITINERARY_LIMITS.maxImageBytes,
    description: 'GEN-08: file size in bytes, at most 5 MB.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ITINERARY_LIMITS.maxImageBytes)
  sizeBytes: number;
}
