import { ServiceUnavailableException } from '@nestjs/common';

export interface WhatsAppProvider {
  readonly configured: boolean;
  sendTemplate(
    to: string,
    template: string,
    variables: Record<string, string>,
  ): Promise<{ providerMessageId?: string }>;
}

export class WhatsAppProviderAdapter implements WhatsAppProvider {
  get configured(): boolean {
    const provider = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase();
    const token = process.env.WHATSAPP_API_TOKEN?.trim().toLowerCase();
    if (
      !provider ||
      provider === 'development' ||
      !token ||
      token.includes('placeholder') ||
      token.startsWith('dev-')
    ) {
      return false;
    }
    return true;
  }

  async sendTemplate(
    _to: string,
    _template: string,
    _variables: Record<string, string>,
  ): Promise<{ providerMessageId?: string }> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'WhatsApp provider is not configured for this environment.',
      );
    }
    return {};
  }
}
