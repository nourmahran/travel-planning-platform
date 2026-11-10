import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  Matches,
  IsBoolean,
  Equals,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  password: string;

  @IsBoolean()
  @Equals(true, { message: 'You must accept the Terms and Conditions' })
  acceptedTerms: boolean;

  @IsBoolean()
  @Equals(true, { message: 'You must accept the Privacy Policy' })
  acceptedPrivacyPolicy: boolean;
}