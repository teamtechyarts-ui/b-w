import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { MailService } from '../mail/mail.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly mail: MailService) {}

  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('email')
  checkEmail() {
    return this.mail.getDiagnosticStatus();
  }
}