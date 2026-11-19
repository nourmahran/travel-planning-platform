import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** ACC-02 resend and ACC-07 forgot-password both take only an email. */
export class EmailOnlyDto {
  @ApiProperty({ example: 'traveller@example.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;
}

/** ACC-07: set a new password with the code from the reset email. */
export class ResetPasswordDto {
  @ApiProperty({ description: 'Reset code from the email' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  @ApiProperty({
    example: 'NewPass123!',
    format: 'password',
    minLength: 8,
    description: 'At least 8 characters, including a letter and a number',
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  newPassword: string;
}
