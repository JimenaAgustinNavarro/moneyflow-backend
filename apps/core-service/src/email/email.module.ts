import { Module } from '@nestjs/common';
import { EMAIL_SENDER } from './email-sender.port';
import { SmtpEmailSender } from './smtp-email.sender';

@Module({
  providers: [
    SmtpEmailSender,
    {
      provide: EMAIL_SENDER,
      useExisting: SmtpEmailSender,
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
