import { Module } from '@nestjs/common';
import { MailModule } from './mail.module';
import { NotificationEmailService } from './notification-email.service';

/** GEN-01-B outbox job; needs the MongoDB connection. */
@Module({
  imports: [MailModule],
  providers: [NotificationEmailService],
})
export class NotificationEmailModule {}
