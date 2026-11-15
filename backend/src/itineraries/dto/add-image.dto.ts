import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddImageDto {
  @ApiProperty({
    example: 'https://cdn.example.com/pyramids.png',
    description:
      'Image URL until Member 6 media upload exists; the media service will own the final size and type limits.',
  })
  @IsUrl()
  @Length(1, 2048)
  url: string;

  @ApiPropertyOptional({ example: 'image/png' })
  @IsOptional()
  @IsString()
  @Matches(/^[\w.+-]+\/[\w.+-]+$/, {
    message: 'mimeType must look like image/png',
  })
  mimeType?: string;

  @ApiPropertyOptional({ example: 204800, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}
