import { Global, Module, OnModuleInit } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { SupabaseService } from '../supabase/supabase.service';

@Global()
@Module({
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeGateway, RealtimeService],
})
export class RealtimeModule implements OnModuleInit {
  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly supabase: SupabaseService,
  ) {}

  onModuleInit() {
    this.supabase.setRealtimeService(this.realtimeService);
  }
}
