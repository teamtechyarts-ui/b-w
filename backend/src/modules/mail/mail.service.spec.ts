import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer');

describe('MailService', () => {
  let service: MailService;
  let mockTransporter: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransporter = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
      verify: jest.fn().mockResolvedValue(true),
    };
    (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);
  });

  describe('when SMTP credentials are fully configured', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'SMTP_USER') return 'test@gmail.com';
                if (key === 'SMTP_APP_PASSWORD') return 'abcd efgh ijkl mnop';
                if (key === 'SMTP_FROM_NAME') return 'Bright & White Test';
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<MailService>(MailService);
    });

    it('initializes transporter with sanitized credentials and reports configured', () => {
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          pool: true,
          service: 'gmail',
          auth: {
            user: 'test@gmail.com',
            pass: 'abcdefghijklmnop',
          },
        }),
      );
      expect(service.isConfigured()).toBe(true);
    });

    it('verifies SMTP connection successfully', async () => {
      const verified = await service.verifyConnection();
      expect(verified).toBe(true);
      expect(mockTransporter.verify).toHaveBeenCalled();
    });

    it('sends email successfully with sender branding', async () => {
      await service.sendMail({
        to: 'customer@example.com',
        subject: 'Welcome',
        text: 'Hello Customer',
        html: '<p>Hello Customer</p>',
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: '"Bright & White Test" <test@gmail.com>',
        to: 'customer@example.com',
        subject: 'Welcome',
        text: 'Hello Customer',
        html: '<p>Hello Customer</p>',
      });
    });

    it('sends password reset OTP with both plain text and HTML containing the OTP', async () => {
      await service.sendPasswordResetOtp('user@example.com', '654321', 10);

      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockTransporter.sendMail.mock.calls[0][0];

      expect(callArgs.to).toBe('user@example.com');
      expect(callArgs.subject).toContain('Password Reset Code');
      expect(callArgs.text).toContain('654321');
      expect(callArgs.text).toContain('10 minutes');
      expect(callArgs.html).toContain('654321');
      expect(callArgs.html).toContain('10 minutes');
      expect(callArgs.html).toContain('Bright &amp; White');
    });

    it('sends email verification OTP with logo attachment, plain text and HTML containing the OTP', async () => {
      await service.sendEmailVerificationOtp('verify@example.com', '123456', 10);

      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockTransporter.sendMail.mock.calls[0][0];

      expect(callArgs.to).toBe('verify@example.com');
      expect(callArgs.subject).toContain('Verify Your Email Address');
      expect(callArgs.text).toContain('123456');
      expect(callArgs.text).toContain('10 minutes');
      expect(callArgs.html).toContain('123456');
      expect(callArgs.html).toContain('10 minutes');
      expect(callArgs.html).toContain('Verify Your Email Address');
      expect(callArgs.html).toContain('cid:bwlogo');
      expect(callArgs.attachments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            filename: 'bw_logo.png',
            cid: 'bwlogo',
          }),
        ]),
      );
    });


    it('handles SMTP sendMail failure gracefully by throwing ServiceUnavailableException', async () => {
      mockTransporter.sendMail.mockRejectedValueOnce(new Error('Connection timeout'));

      await expect(
        service.sendMail({
          to: 'customer@example.com',
          subject: 'Test',
          text: 'Text',
          html: '<p>HTML</p>',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('when SMTP credentials are not configured', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => undefined),
            },
          },
        ],
      }).compile();

      service = module.get<MailService>(MailService);
    });

    it('reports unconfigured and does not initialize transporter', () => {
      expect(service.isConfigured()).toBe(false);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('returns false on verifyConnection when unconfigured', async () => {
      const verified = await service.verifyConnection();
      expect(verified).toBe(false);
    });

    it('throws ServiceUnavailableException when attempting to send mail without configuration', async () => {
      await expect(
        service.sendMail({
          to: 'customer@example.com',
          subject: 'Test',
          text: 'Text',
          html: '<p>HTML</p>',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
