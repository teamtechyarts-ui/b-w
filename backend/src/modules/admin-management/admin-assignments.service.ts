import {BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../supabase/supabase.service';

const ACTIVE = ['assigned', 'accepted', 'en_route', 'arrived'];
const ELIGIBLE: Record<string, string[]> = {pickup: ['confirmed', 'pickup_failed'], delivery: ['ready_for_delivery', 'delivery_failed']};
const STALE_MINUTES = 30;

@Injectable()
export class AdminAssignmentsService {
  constructor(private readonly supabase: SupabaseService) {}
  private get db() { return this.supabase.admin; }

  async overview() {
    const [ordersResult, activeResult, recentResult, driversResult] = await Promise.all([
      this.db.from('orders').select('id,order_number,current_status,created_at,pickup_scheduled_at')
        .in('current_status', [...ELIGIBLE.pickup, ...ELIGIBLE.delivery,
          'pickup_assigned', 'pickup_accepted', 'en_route_pickup', 'pickup_otp_pending',
          'delivery_assigned', 'delivery_accepted', 'en_route_delivery', 'delivery_otp_pending'])
        .order('created_at', {ascending: false}).limit(200),
      this.db.from('driver_assignments').select('id,order_id,driver_id,assignment_type,status,assigned_at,accepted_at,completed_at,rejection_reason')
        .in('status', ACTIVE),
      this.db.from('driver_assignments').select('id,order_id,driver_id,assignment_type,status,assigned_at,accepted_at,completed_at,rejection_reason')
        .order('assigned_at', {ascending: false}).limit(500),
      this.db.from('drivers').select('id,profile_id,is_active,is_available,max_concurrent_jobs,profiles(full_name,is_active)'),
    ]);
    if (ordersResult.error || activeResult.error || recentResult.error || driversResult.error) throw new BadRequestException('Unable to load assignment operations');
    const assignments = [...new Map([...(activeResult.data ?? []), ...(recentResult.data ?? [])].map(row => [row.id, row])).values()]
      .sort((a, b) => b.assigned_at.localeCompare(a.assigned_at));
    const byOrder = new Map<string, typeof assignments>();
    for (const assignment of assignments) byOrder.set(assignment.order_id, [...(byOrder.get(assignment.order_id) ?? []), assignment]);
    const jobs = (ordersResult.data ?? []).map(order => {
      const type: 'pickup' | 'delivery' = ELIGIBLE.pickup.includes(order.current_status) || order.current_status.startsWith('pickup_') || order.current_status === 'en_route_pickup' ? 'pickup' : 'delivery';
      const history = (byOrder.get(order.id) ?? []).filter(row => row.assignment_type === type);
      const active = history.find(row => ACTIVE.includes(row.status));
      return {orderId: order.id, orderNumber: order.order_number, orderStatus: order.current_status,
        type, assignment: active ?? null, lastAssignment: history[0] ?? null,
        canAssign: ELIGIBLE[type].includes(order.current_status) && !active,
        stale: !!active && active.status === 'assigned' && Date.now() - Date.parse(active.assigned_at) > STALE_MINUTES * 60_000};
    });
    const drivers = (driversResult.data ?? []).map(driver => ({
      id: driver.id, name: (driver.profiles as any)?.full_name ?? 'Driver',
      isActive: driver.is_active && (driver.profiles as any)?.is_active === true,
      isAvailable: driver.is_available, maxConcurrentJobs: driver.max_concurrent_jobs,
      activeJobs: assignments.filter(row => row.driver_id === driver.id && ACTIVE.includes(row.status)).length,
    }));
    return {jobs, drivers, staleAfterMinutes: STALE_MINUTES};
  }

  async detail(orderId: string) {
    const {data: order, error: orderError} = await this.db.from('orders')
      .select('id,order_number,current_status').eq('id', orderId).maybeSingle();
    if (orderError || !order) throw new NotFoundException('Order not found');
    const [history, audit] = await Promise.all([
      this.db.from('driver_assignments').select('id,driver_id,assignment_type,status,assigned_at,accepted_at,completed_at,rejection_reason')
        .eq('order_id', orderId).order('assigned_at', {ascending: false}),
      this.db.from('admin_assignment_audit').select('id,actor_profile_id,previous_assignment_id,new_assignment_id,action,created_at')
        .eq('order_id', orderId).order('created_at', {ascending: false}),
    ]);
    if (history.error || audit.error) throw new BadRequestException('Unable to load assignment history');
    const active = (history.data ?? []).find(row => ACTIVE.includes(row.status));
    let tracking: {recordedAt: string; stale: boolean} | null = null;
    if (active) {
      const result = await this.db.from('driver_trip_locations').select('recorded_at')
        .eq('assignment_id', active.id).maybeSingle();
      if (result.error) throw new BadRequestException('Unable to load tracking state');
      if (result.data) tracking = {recordedAt: result.data.recorded_at,
        stale: Date.now() - Date.parse(result.data.recorded_at) > 5 * 60_000};
    }
    return {order, assignments: history.data ?? [], audit: audit.data ?? [], tracking};
  }

  private result(data: any, error: any, action: string) {
    if (error?.code === '42501') throw new ForbiddenException('Admin role required');
    if (error?.code === 'P0002') throw new NotFoundException('Assignment or order not found');
    if (error || !data?.assignment) throw new ConflictException(error?.message ?? `Unable to ${action} Driver`);
    return data;
  }

  private async notifyAssignmentChange(orderId: string, driverId: string, action: string) {
    try {
      if (typeof this.supabase?.broadcastEvent !== 'function' || !orderId || typeof this.db?.from !== 'function') return;
      const { data: ord } = await this.db.from('orders')
        .select('id,order_number,current_status,facility_id,customer_id,customers(profile_id)')
        .eq('id', orderId)
        .maybeSingle();

      const payload = {
        eventType: 'ASSIGNMENT_UPDATED',
        entityId: orderId,
        orderId,
        orderNumber: ord?.order_number,
        status: ord?.current_status,
        driverId,
        action,
        timestamp: new Date().toISOString(),
      };

      const broadcasts: Promise<any>[] = [
        this.supabase.broadcastEvent('orders:all', 'ORDER_STATUS_CHANGED', payload),
        this.supabase.broadcastEvent(`order:${orderId}`, 'ORDER_STATUS_CHANGED', payload),
        this.supabase.broadcastEvent('admin:operations', 'ORDER_STATUS_CHANGED', payload),
        this.supabase.broadcastEvent(`driver:${driverId}`, 'ASSIGNMENT_UPDATED', payload),
        this.supabase.broadcastEvent('driver:available', 'JOB_CLAIMED', payload),
        this.supabase.broadcastEvent('jobs:drivers', 'JOB_CLAIMED', payload),
        this.supabase.broadcastEvent('facility:all', 'ASSIGNMENT_UPDATED', payload),
      ];

      if (ord?.facility_id) {
        broadcasts.push(
          this.supabase.broadcastEvent(`facility:${ord.facility_id}`, 'ASSIGNMENT_UPDATED', payload),
        );
      }

      if (ord?.customer_id) {
        broadcasts.push(
          this.supabase.broadcastEvent(`customer:${ord.customer_id}`, 'ORDER_STATUS_CHANGED', payload),
        );
      }
      const profileId = (ord as any)?.customers?.profile_id;
      if (profileId && profileId !== ord?.customer_id) {
        broadcasts.push(
          this.supabase.broadcastEvent(`customer:${profileId}`, 'ORDER_STATUS_CHANGED', payload),
        );
      }

      await Promise.allSettled(broadcasts);

      // 1. Notify Customer about driver assignment
      const customerProfileId = (ord as any)?.customers?.profile_id || ord?.customer_id;
      if (customerProfileId && typeof (this.supabase as any)?.createAndBroadcastNotification === 'function') {
        await (this.supabase as any).createAndBroadcastNotification({
          profileId: customerProfileId,
          orderId,
          notificationType: 'driver_assigned',
          title: 'Driver Assigned',
          body: `A driver has been assigned for ${action || 'pickup'} of your order #${ord?.order_number || ''}.`,
          data: { orderId, orderNumber: ord?.order_number, driverId, status: ord?.current_status, action },
          channels: [`customer:${customerProfileId}`, `order:${orderId}`],
        });
      }

      // 2. Notify Driver about new job assignment
      if (driverId && typeof (this.supabase as any)?.createAndBroadcastNotification === 'function') {
        let driverProfileId = driverId;
        try {
          const { data: drv } = await this.db.from('drivers').select('profile_id').eq('id', driverId).maybeSingle();
          if (drv?.profile_id) driverProfileId = drv.profile_id;
        } catch {}

        await (this.supabase as any).createAndBroadcastNotification({
          profileId: driverProfileId,
          orderId,
          notificationType: 'driver_job_assigned',
          title: 'New Job Assigned',
          body: `You have been assigned order #${ord?.order_number || ''} for ${action || 'pickup'}.`,
          data: { orderId, orderNumber: ord?.order_number, driverId, action },
          channels: [`driver:${driverProfileId}`, `driver:${driverId}`],
        });
      }
    } catch {
      // Safe catch
    }
  }

  async assign(actorId: string, orderId: string, driverId: string, type: string) {
    if (!driverId || !['pickup', 'delivery'].includes(type)) throw new BadRequestException('Driver and pickup or delivery type required');
    let data: any;
    let error: any;

    const rpcRes = await this.db.rpc('admin_assign_driver_atomic', {
      p_admin_profile_id: actorId, p_order_id: orderId, p_driver_id: driverId, p_assignment_type: type,
    });
    if (!rpcRes.error) {
      data = rpcRes.data;
    } else if (rpcRes.error.code === 'PGRST202') {
      const coreRes = await this.db.rpc('create_driver_assignment_atomic', {
        p_order_id: orderId, p_driver_id: driverId, p_assignment_type: type, p_assignment_score: null,
      });
      data = coreRes.data;
      error = coreRes.error;
      if (!error && data?.assignment?.id && typeof this.db?.from === 'function') {
        await this.db.from('admin_assignment_audit').insert({
          actor_profile_id: actorId,
          order_id: orderId,
          new_assignment_id: data.assignment.id,
          action: 'assign',
        });
      }
    } else {
      error = rpcRes.error;
    }
    const result = this.result(data, error, 'assign');
    await this.notifyAssignmentChange(orderId, driverId, 'assign');
    return result;
  }

  async reassign(actorId: string, assignmentId: string, driverId: string) {
    if (!driverId) throw new BadRequestException('Replacement Driver required');
    let data: any;
    let error: any;
    let targetOrderId = '';

    const rpcRes = await this.db.rpc('admin_reassign_driver_atomic', {
      p_admin_profile_id: actorId, p_assignment_id: assignmentId, p_new_driver_id: driverId,
    });
    if (!rpcRes.error) {
      data = rpcRes.data;
      targetOrderId = data?.assignment?.order_id || data?.orderId || '';
    } else if (rpcRes.error.code === 'PGRST202') {
      let currentAss: any = null;
      if (typeof this.db?.from === 'function') {
        const assRes = await this.db.from('driver_assignments')
          .select('id,order_id,assignment_type').eq('id', assignmentId).maybeSingle();
        currentAss = assRes.data;
      }
      if (!currentAss) throw new NotFoundException('Assignment not found');
      targetOrderId = currentAss.order_id;

      if (typeof this.db?.from === 'function') {
        await this.db.from('driver_assignments').update({ status: 'reassignment_required' }).eq('id', assignmentId);
      }

      const coreRes = await this.db.rpc('create_driver_assignment_atomic', {
        p_order_id: currentAss.order_id, p_driver_id: driverId, p_assignment_type: currentAss.assignment_type, p_assignment_score: null,
      });
      data = coreRes.data;
      error = coreRes.error;
      if (!error && data?.assignment?.id && typeof this.db?.from === 'function') {
        await this.db.from('admin_assignment_audit').insert({
          actor_profile_id: actorId,
          order_id: currentAss.order_id,
          previous_assignment_id: assignmentId,
          new_assignment_id: data.assignment.id,
          action: 'reassign',
        });
      }
    } else {
      error = rpcRes.error;
    }
    const result = this.result(data, error, 'reassign');
    await this.notifyAssignmentChange(targetOrderId || result?.assignment?.order_id, driverId, 'reassign');
    return result;
  }
}
