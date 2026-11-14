
  import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  Matches,
  IsBoolean,
  Equals,
} from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    example: 'Roba Tarek',
    description: 'Full name of the user',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 'roba@example.com',
    description: 'Unique email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'TestPass123!',
    description: 'At least 8 characters, including a letter and a number',
    minLength: 8,
    format: 'password',
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  password: string;

  @ApiProperty({
    example: true,
    description: 'User must accept the Terms and Conditions',
  })
  @IsBoolean()
  @Equals(true, {
    message: 'You must accept the Terms and Conditions',
  })
  acceptedTerms: boolean;

  @ApiProperty({
    example: true,
    description: 'User must accept the Privacy Policy',
  })
  @IsBoolean()
  @Equals(true, {
    message: 'You must accept the Privacy Policy',
  })
  acceptedPrivacyPolicy: boolean;
}