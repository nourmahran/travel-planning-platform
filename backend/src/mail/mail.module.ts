import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Outgoing email; no database needed, so any module can import it. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
