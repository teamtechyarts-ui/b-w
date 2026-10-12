import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  SupabaseClient,
  User,
} from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  public readonly client: SupabaseClient;
  public readonly admin: SupabaseClient;

  private readonly url: string;
  private readonly anonKey: string;

  constructor(private readonly config: ConfigService) {
    this.url =
      this.config.getOrThrow<string>('SUPABASE_URL');

    this.anonKey =
      this.config.get<string>('SUPABASE_PUBLISHABLE_KEY') ??
      this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    const serviceRoleKey =
      this.config.get<string>('SUPABASE_SECRET_KEY') ??
      this.config.getOrThrow<string>(
        'SUPABASE_SERVICE_ROLE_KEY',
      );

    this.client = createClient(
      this.url,
      this.anonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    this.admin = createClient(
      this.url,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  getUrl(): string {
    return this.url;
  }

  getAnonKey(): string {
    return this.anonKey;
  }

  async broadcastEvent(channelName: string, event: string, payload: any): Promise<void> {
    try {
      const sanitized = { ...payload };
      delete sanitized.pickupOtp;
      delete sanitized.deliveryOtp;
      delete sanitized.otp;
      delete sanitized.driverPin;
      delete sanitized.pin;
      delete sanitized.secret;
      delete sanitized.paymentSecret;

      const ch = this.admin.channel(channelName);
      await ch.send({
        type: 'broadcast',
        event,
        payload: {
          ...sanitized,
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      // Broadcast error must not break primary business transaction
    }
  }

  createAuthClient(): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async getUser(accessToken: string): Promise<User | null> {
    if (!accessToken) {
      return null;
    }

    const {
      data,
      error,
    } = await this.client.auth.getUser(accessToken);

    if (error || !data?.user) {
      return null;
    }

    return data.user as User;
  }

  async updateUserPassword(
    accessToken: string,
    newPassword: string,
  ): Promise<{ error: { message: string } | null }> {
    try {
      const res = await fetch(`${this.url}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: newPassword }),
      });

      if (!res.ok) {
        const data: any = await res.json().catch(() => null);
        const message =
          data?.msg || data?.message || 'Unable to update password. Please try again.';
        return { error: { message } };
      }

      return { error: null };
    } catch (cause: any) {
      return { error: { message: cause?.message || 'Network error updating password' } };
    }
  }

  createUserClient(
    accessToken: string,
  ): SupabaseClient {
    const client = createClient(
      this.url,
      this.anonKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const originalUpdateUser = client.auth.updateUser.bind(client.auth);
    client.auth.updateUser = (async (attributes: any, options?: any) => {
      if (attributes?.password) {
        const updateResult = await this.updateUserPassword(accessToken, attributes.password);
        if (updateResult.error) {
          return { data: { user: null }, error: updateResult.error as any };
        }
        const user = await this.getUser(accessToken);
        return { data: { user }, error: null };
      }
      return originalUpdateUser(attributes, options);
    }) as any;

    return client;
  }
}
