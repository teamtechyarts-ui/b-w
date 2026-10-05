import {BadRequestException, ConflictException, Injectable, NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../supabase/supabase.service';

@Injectable()
export class AdminManagementService {
  constructor(private readonly supabase: SupabaseService) {}

  private get db() { return this.supabase.admin; }

  async customers(search = '') {
    const term = search.trim();
    if (term.length > 100) throw new BadRequestException('Search is too long');
    let customerIdsFromOrders: string[] = [];
    let profiles: string[] | undefined;
    if (term) {
      const safe = term.replace(/[%_,()\\]/g, '');
      if (!safe) return [];
      
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(safe);
      const orderSearch = await this.db.from('orders').select('customer_id')
        .or(`order_number.ilike.%${safe}%,id.eq.${isUuid ? safe : '00000000-0000-0000-0000-000000000000'}`)
        .limit(20);
      if (orderSearch.data?.length) {
        customerIdsFromOrders = orderSearch.data.map(o => o.customer_id);
      }

      const result = await this.db.from('profiles').select('id')
        .or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%`).limit(100);
      if (result.error) throw new BadRequestException('Unable to search customers');
      profiles = (result.data ?? []).map(row => row.id);
      if (!profiles.length && !customerIdsFromOrders.length) return [];
    }
    let query = this.db.from('customers')
      .select('id,profile_id,created_at,profiles(id,full_name,phone,is_active)')
      .order('created_at', {ascending: false}).limit(50);
    if (profiles && customerIdsFromOrders.length) {
      query = query.or(`profile_id.in.(${profiles.join(',')}),id.in.(${customerIdsFromOrders.join(',')})`);
    } else if (profiles && profiles.length) {
      query = query.in('profile_id', profiles);
    } else if (customerIdsFromOrders.length) {
      query = query.in('id', customerIdsFromOrders);
    }
    const {data, error} = await query;
    if (error) throw new BadRequestException('Unable to load customers');
    return data ?? [];
  }

  async customer(customerId: string) {
    const {data, error} = await this.db.from('customers')
      .select('id,profile_id,created_at,profiles(id,full_name,phone,is_active),customer_addresses(id,label,address_line1,address_line2,city,state,postal_code,is_default)')
      .eq('id', customerId).maybeSingle();
    if (error || !data) throw new NotFoundException('Customer not found');
    return data;
  }

  async orders(customerId: string) {
    await this.customer(customerId);
    const {data, error} = await this.db.from('orders')
      .select('id,order_number,current_status,subtotal,discount_amount,total_amount,payment_method,created_at,updated_at')
      .eq('customer_id', customerId).order('created_at', {ascending: false}).limit(100);
    if (error) throw new BadRequestException('Unable to load customer orders');
    return data ?? [];
  }

  async order(identifier: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
    let orderQuery = this.db.from('orders')
      .select('*,order_items(*),order_status_history(*),order_qr_codes(id,secure_token,is_active),customers(id,profile_id,profiles(id,full_name,phone)),pickup_address:customer_addresses!orders_pickup_address_id_fkey(*),delivery_address:customer_addresses!orders_delivery_address_id_fkey(*),facilities:facilities!orders_facility_id_fkey(id,name,address),driver_assignments(*,drivers(*,profiles(full_name,phone)))');
    if (isUuid) {
      orderQuery = orderQuery.eq('id', identifier);
    } else {
      orderQuery = orderQuery.eq('order_number', identifier);
    }
    const {data: order, error} = await orderQuery.maybeSingle();
    if (error || !order) throw new NotFoundException('Order not found');
    const orderId = order.id;
    const [paymentResult, claimResult] = await Promise.all([
      this.db.from('payment_orders').select('id,provider,amount,currency,status,paid_at,created_at,refund_requests(id,amount,reason,status,is_cancellation_refund,created_at,approved_at,processed_at)')
        .eq('order_id', orderId).order('created_at', {ascending: false}),
      this.db.from('customer_order_claims').select('id,claim_type,description,status,created_at,customer_claim_photos(id,storage_path,created_at)')
        .eq('order_id', orderId).order('created_at', {ascending: false}),
    ]);
    if (paymentResult.error || claimResult.error) throw new BadRequestException('Unable to load order history');
    return {order, payments: paymentResult.data ?? [], claims: claimResult.data ?? []};
  }

  async cancel(actorProfileId: string, orderId: string, reason: string) {
    const {data, error} = await this.db.rpc('cancel_order_by_admin_atomic', {
      p_order_id: orderId, p_admin_profile_id: actorProfileId, p_reason: reason,
    });
    if (error?.code === '42501') throw new BadRequestException('Admin access required');
    if (error?.code === 'P0002') throw new NotFoundException('Order not found');
    if (['23514', '23505', '40001'].includes(error?.code ?? '')) throw new ConflictException(error?.message ?? 'Order cannot be cancelled');
    if (error || !data) throw new BadRequestException(error?.message ?? 'Unable to cancel order');
    return data;
  }
}
