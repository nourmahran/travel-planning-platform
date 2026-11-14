import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

export class DeactivateAccountDto {
  @ApiProperty({
    example: true,
    description: 'Must be true to confirm account deactivation',
  })
  @IsBoolean()
  @Equals(true, { message: 'Confirmation is required to deactivate the account' })
  confirm: boolean;
}
