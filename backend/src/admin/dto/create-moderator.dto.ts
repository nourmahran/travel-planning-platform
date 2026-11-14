import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateModeratorDto {
  @ApiProperty({ example: 'Airline Moderator' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'moderator@airline.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'TempPass123!',
    description: 'Temporary password; must be changed on first login',
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  temporaryPassword: string;

  @ApiProperty({ enum: ['airline', 'hotel'], example: 'airline' })
  @IsIn(['airline', 'hotel'])
  providerType: 'airline' | 'hotel';

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Airline or hotel ObjectId',
  })
  @IsMongoId()
  providerId: string;
}
