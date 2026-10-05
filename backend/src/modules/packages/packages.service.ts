import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service';
import {PAYMENT_PROVIDER, type PaymentProvider} from '../payments/providers/payment.provider';

@Injectable()
export class PackagesService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  private db() {
    return this.supabase.admin;
  }

  async list() {
    const {
      data,
      error,
    } = await this.db()
      .from('packages')
      .select('*,package_services(*)')
      .eq('is_active', true);

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data ?? [];
  }

  async detail(packageId: string) {
    const {data, error} = await this.db().from('packages')
      .select('*,package_services(*)').eq('id', packageId).eq('is_active', true).maybeSingle();
    if (error || !data) throw new NotFoundException('Package not found');
    return data;
  }

  private async customerId(profileId: string) {
    const {data, error} = await this.db().from('customers')
      .select('id').eq('profile_id', profileId).maybeSingle();
    if (error || !data) throw new NotFoundException('Customer not found');
    return data.id as string;
  }

  async mine(profileId: string) {
    const customerId = await this.customerId(profileId);
    const {data: subscriptions, error} = await this.db().from('package_subscriptions')
      .select('*,packages(*,package_services(*))')
      .eq('customer_id', customerId).order('started_at', {ascending: false});
    if (error) throw new BadRequestException('Package history unavailable');
    const {data: usage, error: usageError} = await this.db().from('package_usage')
      .select('subscription_id,service_id,usage_quantity,reversed_at,order_id,created_at')
      .eq('customer_id', customerId);
    if (usageError) throw new BadRequestException('Package usage unavailable');
    const now = Date.now();
    return (subscriptions ?? []).map((subscription: any) => ({
      ...subscription,
      isUsable: subscription.status === 'active' &&
        Date.parse(subscription.starts_at ?? subscription.started_at) <= now &&
        Date.parse(subscription.expires_at) > now,
      services: (subscription.packages?.package_services ?? []).map((service: any) => {
        const used = (usage ?? []).filter((row: any) => row.subscription_id === subscription.id &&
          row.service_id === service.service_id && !row.reversed_at)
          .reduce((sum: number, row: any) => sum + Number(row.usage_quantity), 0);
        return {...service, used, remaining: service.usage_limit == null ? null : Math.max(0, Number(service.usage_limit) - used)};
      }),
      usage: (usage ?? []).filter((row: any) => row.subscription_id === subscription.id),
    }));
  }

  async quote(profileId: string, subscriptionId: string,
    items: Array<{service_id: string; quantity: number; unit_price: number}>) {
    const customerId = await this.customerId(profileId);
    const {data: subscription, error} = await this.db().from('package_subscriptions')
      .select('id,customer_id,package_id,status,starts_at,expires_at')
      .eq('id', subscriptionId).eq('customer_id', customerId).maybeSingle();
    const now = Date.now();
    if (error || !subscription || subscription.status !== 'active' ||
        Date.parse(subscription.starts_at) > now || Date.parse(subscription.expires_at) <= now) {
      throw new BadRequestException('Package is unavailable or expired');
    }
    const {data: limits, error: limitsError} = await this.db().from('package_services')
      .select('service_id,usage_limit').eq('package_id', subscription.package_id);
    const {data: usage, error: usageError} = await this.db().from('package_usage')
      .select('service_id,usage_quantity').eq('subscription_id', subscriptionId).is('reversed_at', null);
    if (limitsError || usageError) throw new BadRequestException('Package balance unavailable');
    const coverages = items.map(item => {
      const limit = (limits ?? []).find((row: any) => row.service_id === item.service_id);
      if (!limit) return {service_id: item.service_id, quantity: 0};
      const used = (usage ?? []).filter((row: any) => row.service_id === item.service_id)
        .reduce((sum: number, row: any) => sum + Number(row.usage_quantity), 0);
      const remaining = limit.usage_limit == null ? item.quantity : Math.max(0, Number(limit.usage_limit) - used);
      return {service_id: item.service_id, quantity: Math.min(item.quantity, remaining)};
    }).filter(row => row.quantity > 0);
    return {subscriptionId, coverages,
      discount: coverages.reduce((sum, row) => sum + row.quantity * Number(items.find(item => item.service_id === row.service_id)!.unit_price), 0)};
  }

  async subscribe(
    _profileId: string,
    _packageId: string,
  ) {
    throw new ServiceUnavailableException('Package purchase requires a configured payment flow');
  }

  async usage(
    profileId: string,
  ) {
    const {
      data: customer,
      error: customerError,
    } = await this.db()
      .from('customers')
      .select('id')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (customerError || !customer) {
      throw new NotFoundException(
        'Customer not found',
      );
    }

    const {
      data,
      error,
    } = await this.db()
      .from('package_usage')
      .select('*,package_services(*)')
      .eq('customer_id', customer.id);

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data ?? [];
  }
}
