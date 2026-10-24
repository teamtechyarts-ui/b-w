import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [HealthController],
})
export class HealthModule {}