import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { NotificationEmailService } from './notification-email.service';

@Global()
@Module({
  providers: [MailService, NotificationEmailService],
  exports: [MailService],
})
export class MailModule {}
