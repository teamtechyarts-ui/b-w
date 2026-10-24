import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { MailService } from '../mail/mail.service';

describe('HealthController', () => {
  let controller: HealthController;
  let mailService: { getDiagnosticStatus: jest.Mock };

  beforeEach(async () => {
    mailService = {
      getDiagnosticStatus: jest.fn().mockResolvedValue({
        configured: true,
        provider: 'Zoho Mail SMTP',
        host: 'smtp.zoho.in',
        port: 465,
        secure: true,
        senderAddress: 'in***o@brightandwhite.in',
        connectionVerified: true,
        deliveryGuarantee: 'SMTP connectivity confirmed.',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: MailService,
          useValue: mailService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return service health status', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBeDefined();
  });

  it('should return email diagnostic status without exposing sensitive credentials', async () => {
    const result = await controller.checkEmail();
    expect(result.configured).toBe(true);
    expect(result.host).toBe('smtp.zoho.in');
    expect(result.port).toBe(465);
    expect(result.secure).toBe(true);
    expect(result.senderAddress).toBe('in***o@brightandwhite.in');
    expect(result.connectionVerified).toBe(true);
    expect((result as any).password).toBeUndefined();
    expect((result as any).smtpPass).toBeUndefined();
  });
});
