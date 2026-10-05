import { Injectable, Logger } from '@nestjs/common';
import { getProviderConfiguration } from '../../config/provider-config';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);
  constructor(private readonly supabase: SupabaseService) {}

  async readiness() {
    const checks: Record<string, boolean> = { api: true, supabase: false };
    try {
      const { error } = await this.supabase.admin.from('profiles').select('id').limit(1).abortSignal(AbortSignal.timeout(3000));
      checks.supabase = !error;
    } catch { this.logger.warn('Supabase readiness check failed'); }
    return { ready: Object.values(checks).every(Boolean), checks, timestamp: new Date().toISOString() };
  }

  providerDiagnostics() {
    const providers = getProviderConfiguration();

    return {
      nodeEnv: providers.nodeEnv,
      maps: {
        configured: providers.maps.configured,
      },
      payments: {
        configured: providers.payments.configured,
      },
    };
  }

  async audit(actorProfileId: string, action: string, metadata: Record<string, unknown> = {}) {
    await this.supabase.admin.from('admin_activity_logs').insert({
      actor_profile_id: actorProfileId, action, metadata
    });
  }
}
