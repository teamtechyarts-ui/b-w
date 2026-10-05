import {ServiceUnavailableException} from '@nestjs/common';
import {PackagesService} from './packages.service';
import type {SupabaseService} from '../supabase/supabase.service';
import type {PaymentProvider} from '../payments/providers/payment.provider';

function database(rows: Record<string, unknown>) {
  const from = jest.fn((table: string) => {
    const query: any = {
      select: () => query, eq: () => query, order: () => query, is: () => query,
      maybeSingle: async () => ({data: rows[table] ?? null, error: null}),
      insert: () => query,
      single: async () => ({data: {id: 'subscription-1'}, error: null}),
      then: (resolve: (value: unknown) => void) => resolve({data: rows[table] ?? [], error: null}),
    };
    return query;
  });
  return {admin: {from}} as unknown as SupabaseService;
}

const liveProvider = {
  mode: 'live',
  createOrder: jest.fn().mockResolvedValue({id: 'provider-order'}),
  verifyCheckoutSignature: jest.fn().mockReturnValue(true),
} as unknown as PaymentProvider;

describe('package purchase safety', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {process.env.NODE_ENV = originalEnv; jest.clearAllMocks();});

  it('rejects direct package activation without payment checkout flow', async () => {
    const service = new PackagesService(database({}), liveProvider);
    await expect(service.subscribe('profile', 'package')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
