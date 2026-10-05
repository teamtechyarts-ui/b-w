import { ServiceUnavailableException } from '@nestjs/common';

export interface SmsProvider {
  readonly configured: boolean;
  send(to: string, body: string): Promise<{ providerMessageId?: string }>;
}

export class SmsProviderAdapter implements SmsProvider {
  get configured(): boolean {
    const provider = process.env.SMS_PROVIDER?.trim().toLowerCase();
    const apiKey = process.env.SMS_PROVIDER_API_KEY?.trim().toLowerCase();
    if (
      !provider ||
      provider === 'development' ||
      !apiKey ||
      apiKey.includes('placeholder') ||
      apiKey.startsWith('dev-')
    ) {
      return false;
    }
    return true;
  }

  async send(_to: string, _body: string): Promise<{ providerMessageId?: string }> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'SMS provider is not configured for this environment.',
      );
    }
    return {};
  }
}
