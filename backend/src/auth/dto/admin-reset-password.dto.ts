import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class AdminResetPasswordDto {
  @ApiProperty({
    example: 'TempPass123!',
    minLength: 8,
    description: 'Temporary password (letter + number required)',
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  temporaryPassword: string;
}
