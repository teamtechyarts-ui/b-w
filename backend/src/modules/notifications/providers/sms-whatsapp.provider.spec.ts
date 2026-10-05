import { ServiceUnavailableException } from '@nestjs/common';
import { SmsProviderAdapter } from './sms.provider';
import { WhatsAppProviderAdapter } from './whatsapp.provider';

describe('SmsProvider and WhatsAppProvider development behavior', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('SmsProviderAdapter', () => {
    it('reports unconfigured and throws ServiceUnavailableException when credentials are missing or dev', async () => {
      delete process.env.SMS_PROVIDER;
      delete process.env.SMS_PROVIDER_API_KEY;

      const provider = new SmsProviderAdapter();
      expect(provider.configured).toBe(false);
      await expect(provider.send('+919876543210', 'Test message')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('rejects placeholders and development setting', async () => {
      process.env.SMS_PROVIDER = 'development';
      process.env.SMS_PROVIDER_API_KEY = 'dev-sms-provider-key';

      const provider = new SmsProviderAdapter();
      expect(provider.configured).toBe(false);
      await expect(provider.send('+919876543210', 'Test message')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('WhatsAppProviderAdapter', () => {
    it('reports unconfigured and throws ServiceUnavailableException when credentials are missing or dev', async () => {
      delete process.env.WHATSAPP_PROVIDER;
      delete process.env.WHATSAPP_API_TOKEN;

      const provider = new WhatsAppProviderAdapter();
      expect(provider.configured).toBe(false);
      await expect(
        provider.sendTemplate('+919876543210', 'order_update', { order_id: '123' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('rejects placeholders and development setting', async () => {
      process.env.WHATSAPP_PROVIDER = 'development';
      process.env.WHATSAPP_API_TOKEN = 'dev-whatsapp-token';

      const provider = new WhatsAppProviderAdapter();
      expect(provider.configured).toBe(false);
      await expect(
        provider.sendTemplate('+919876543210', 'order_update', { order_id: '123' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
