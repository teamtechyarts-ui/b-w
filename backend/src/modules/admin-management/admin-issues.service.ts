import {BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException} from '@nestjs/common';
import {SupabaseService} from '../supabase/supabase.service';
import {PaymentsService} from '../payments/payments.service';

@Injectable()
export class AdminIssuesService {
  constructor(private readonly supabase: SupabaseService, private readonly payments: PaymentsService) {}
  private get db() { return this.supabase.admin; }
  private notes(value: string) {
    const notes = value?.trim() ?? '';
    if (notes.length < 3 || notes.length > 1000) throw new BadRequestException('Decision notes must contain 3 to 1000 characters');
    return notes;
  }
  private result(data: any, error: any, fallback: string) {
    if (error?.code === '42501') throw new ForbiddenException('Admin role required');
    if (error?.code === 'P0002') throw new NotFoundException(error.message);
    if (error && ['23514', '23505', '40001'].includes(error.code)) throw new ConflictException(error.message);
    if (error || !data) throw new BadRequestException(error?.message ?? fallback);
    return data;
  }

  async overview() {
    const [claims, refunds, cancellations] = await Promise.all([
      this.db.from('customer_order_claims').select('id,order_id,claim_type,description,status,created_at')
        .order('created_at', {ascending: false}).limit(100),
      this.db.from('refund_requests').select('id,payment_order_id,payment_transaction_id,amount,reason,status,is_cancellation_refund,created_at,payment_orders(order_id),payment_transactions(order_id)')
        .order('created_at', {ascending: false}).limit(100),
      this.db.from('orders').select('id,order_number,current_status,updated_at').eq('current_status', 'cancelled')
        .order('updated_at', {ascending: false}).limit(100),
    ]);
    if (claims.error || refunds.error || cancellations.error) throw new BadRequestException('Unable to load customer issues');
    
    const mappedRefunds = (refunds.data ?? []).map((r: any) => {
      const orderId = r.payment_orders?.order_id || r.payment_transactions?.order_id || null;
      return {
        ...r,
        order_id: orderId,
        payment_orders: orderId ? { order_id: orderId } : null,
      };
    });

    return {claims: claims.data ?? [], refunds: mappedRefunds, cancellations: cancellations.data ?? []};
  }

  async order(orderId: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
    let orderQuery = this.db.from('orders')
      .select('id,order_number,customer_id,current_status,total_amount,payment_method,created_at,customers(profile_id,profiles(full_name,phone))');
    if (isUuid) {
      orderQuery = orderQuery.eq('id', orderId);
    } else {
      orderQuery = orderQuery.or(`id.eq.${orderId},order_number.eq.${orderId}`);
    }
    const {data: order, error} = await orderQuery.maybeSingle();
    if (error || !order) throw new NotFoundException('Order not found');

    const resolvedOrderId = order.id;
    const [claims, payments, cancellation, audit] = await Promise.all([
      this.db.from('customer_order_claims').select('id,order_id,claim_type,description,status,resolution_notes,reviewed_at,created_at,customer_claim_photos(id,storage_path,created_at)')
        .eq('order_id', resolvedOrderId).order('created_at', {ascending: false}),
      this.db.from('payment_orders').select('id,order_id,provider,amount,currency,status,paid_at,provider_payment_id,refund_requests(id,amount,reason,status,is_cancellation_refund,created_at,approved_at,processed_at)')
        .eq('order_id', resolvedOrderId).order('created_at', {ascending: false}),
      this.db.from('order_status_history').select('id,from_status,to_status,reason,changed_by,created_at')
        .eq('order_id', resolvedOrderId).eq('to_status', 'cancelled').order('created_at', {ascending: false}),
      this.db.from('admin_issue_decision_audit').select('id,action,notes,before_status,after_status,created_at')
        .eq('order_id', resolvedOrderId).order('created_at', {ascending: false}),
    ]);
    if (claims.error || payments.error || cancellation.error || audit.error) throw new BadRequestException('Unable to load issue details');
    const evidence = await Promise.all((claims.data ?? []).map(async claim => ({
      ...claim,
      customer_claim_photos: await Promise.all((claim.customer_claim_photos ?? []).map(async photo => {
        try {
          if (!this.db?.storage) {
            return {...photo, signedUrl: null};
          }
          const signed = await this.db.storage.from('customer-claim-photos').createSignedUrl(photo.storage_path, 3600);
          const signedUrl = signed.data?.signedUrl ?? null;
          return {...photo, signedUrl};
        } catch {
          return {...photo, signedUrl: null};
        }
      })),
    }))); 
    const paymentRows = (payments.data ?? []).map(payment => {
      const committed = (payment.refund_requests ?? []).filter(refund =>
        ['requested','under_review','approved','processing','completed'].includes(refund.status))
        .reduce((sum, refund) => sum + Number(refund.amount), 0);
      return {...payment, refundableAmount: ['paid','partially_refunded'].includes(payment.status) && payment.provider_payment_id
        ? Math.max(0, Math.round((Number(payment.amount) - committed) * 100) / 100) : 0};
    });

    // If no online payment_orders rows exist (e.g. COD orders), populate payment & refunds from payment_transactions
    if (paymentRows.length === 0) {
      const { data: txRows } = await this.db.from('payment_transactions')
        .select('id,order_id,amount,currency,payment_method,status,created_at')
        .eq('order_id', resolvedOrderId);
      const txIds = (txRows ?? []).map(t => t.id);

      let codRefunds: any[] = [];
      if (txIds.length > 0) {
        const { data: rfs } = await this.db.from('refund_requests')
          .select('id,amount,reason,status,is_cancellation_refund,created_at,approved_at,processed_at,payment_transaction_id')
          .in('payment_transaction_id', txIds)
          .order('created_at', { ascending: false });
        codRefunds = rfs ?? [];
      }

      const totalOrderAmount = Number(order.total_amount || 0);
      const committed = codRefunds
        .filter(r => ['requested', 'under_review', 'approved', 'processing', 'completed'].includes(r.status))
        .reduce((sum, r) => sum + Number(r.amount), 0);

      paymentRows.push({
        id: txIds[0] || `tx-${resolvedOrderId}`,
        order_id: resolvedOrderId,
        provider: order.payment_method || 'cod',
        amount: totalOrderAmount,
        currency: 'INR',
        status: order.payment_method === 'cod' ? 'paid' : 'completed',
        paid_at: null,
        provider_payment_id: null,
        refundableAmount: Math.max(0, Math.round((totalOrderAmount - committed) * 100) / 100),
        refund_requests: codRefunds,
      });

    }

    return {order, claims: evidence, payments: paymentRows, cancellationHistory: cancellation.data ?? [], audit: audit.data ?? []};
  }

  private async ensureClaimRefund(
    actor: string,
    orderId: string,
    claimId: string,
    amount: number,
    notes: string,
  ) {
    const claimTag = `[Claim ${claimId.slice(0, 8)}]`;
    const now = new Date().toISOString();

    // Check if refund already exists for this claim
    const { data: existingRefunds } = await this.db
      .from('refund_requests')
      .select('id,payment_order_id,payment_transaction_id,amount,status,reason')
      .like('reason', `%${claimTag}%`);

    if (existingRefunds && existingRefunds.length > 0) {
      const existing = existingRefunds[0];
      if (existing.status !== 'approved' && existing.status !== 'completed') {
        await this.db
          .from('refund_requests')
          .update({
            status: 'approved',
            amount,
            approved_by: actor,
            approved_at: now,
          })
          .eq('id', existing.id);
      }
      return existing;
    }

    // Check for online payment_orders row
    const { data: paymentOrder } = await this.db
      .from('payment_orders')
      .select('id,status')
      .eq('order_id', orderId)
      .maybeSingle();

    let paymentOrderId: string | null = paymentOrder?.id || null;
    let paymentTransactionId: string | null = null;

    if (!paymentOrderId) {
      // Find or create payment_transactions row for COD / direct reimbursement
      const { data: tx } = await this.db
        .from('payment_transactions')
        .select('id')
        .eq('order_id', orderId)
        .maybeSingle();

      if (tx) {
        paymentTransactionId = tx.id;
      } else {
        const { data: order } = await this.db
          .from('orders')
          .select('customer_id,total_amount,payment_method')
          .eq('id', orderId)
          .single();

        const { data: newTx } = await this.db
          .from('payment_transactions')
          .insert({
            order_id: orderId,
            customer_id: order?.customer_id,
            amount: amount,
            currency: 'INR',
            payment_method: order?.payment_method || 'cod',
            status: 'completed',
          })
          .select()
          .maybeSingle();

        paymentTransactionId = newTx?.id || null;
      }
    }

    const refundReason = notes.includes(claimTag) ? notes : `${notes} ${claimTag}`;
    const { data: newRefund, error: refErr } = await this.db
      .from('refund_requests')
      .insert({
        payment_order_id: paymentOrderId,
        payment_transaction_id: paymentTransactionId,
        amount,
        reason: refundReason,
        status: 'approved',
        approved_by: actor,
        approved_at: now,
        is_cancellation_refund: false,
      })
      .select()
      .maybeSingle();

    if (refErr || !newRefund) {
      console.warn('[ENSURE_CLAIM_REFUND_INSERT_WARNING]', refErr);
      return null;
    }

    try {
      await this.db.from('admin_issue_decision_audit').insert({
        actor_profile_id: actor,
        order_id: orderId,
        refund_id: newRefund.id,
        action: 'claim_refund_approve',
        notes: refundReason,
        after_status: 'approved',
      });
    } catch (auditErr) {
      console.warn('[ENSURE_CLAIM_REFUND_AUDIT_WARNING]', auditErr);
    }

    try {
      if (typeof (this.supabase as any)?.broadcastEvent === 'function') {
        const payload = {
          eventType: 'REFUND_APPROVED',
          entityId: newRefund.id,
          orderId,
          refund: newRefund,
          timestamp: now,
        };
        await this.supabase.broadcastEvent('admin:operations', 'REFUND_APPROVED', payload);
        await this.supabase.broadcastEvent(`order:${orderId}`, 'REFUND_APPROVED', payload);

        if (typeof (this.supabase as any)?.createAndBroadcastNotification === 'function') {
          const { data: ord } = await this.db.from('orders').select('customer_id,customers(profile_id)').eq('id', orderId).maybeSingle();
          const customerProfileId = (ord as any)?.customers?.profile_id || ord?.customer_id;
          if (customerProfileId) {
            await (this.supabase as any).createAndBroadcastNotification({
              profileId: customerProfileId,
              orderId,
              notificationType: 'refund_processed',
              title: 'Refund Approved',
              body: `A refund of ₹${newRefund.amount} has been approved for your order.`,
              data: { orderId, refundId: newRefund.id, amount: newRefund.amount },
              channels: [`customer:${customerProfileId}`, `user:${customerProfileId}`],
            });
          }
        }
      }
    } catch (bErr) {
      console.warn('[ENSURE_CLAIM_REFUND_BROADCAST_WARNING]', bErr);
    }

    return newRefund;
  }

  async claimDecision(
    actor: string,
    orderId: string,
    claimId: string,
    status: string,
    notes: string,
    refundOptions?: {
      refundAmount?: number;
      approveRefund?: boolean;
      refundReason?: string;
    },
  ) {
    const validNotes = this.notes(notes);
    const {data: claim, error} = await this.db.from('customer_order_claims').select('*')
      .eq('id', claimId).eq('order_id', orderId).maybeSingle();
    if (error || !claim) throw new NotFoundException('Claim does not belong to this order');

    const result = await this.db.rpc('admin_review_customer_claim_atomic', {
      p_claim_id: claimId, p_admin_id: actor, p_target_status: status, p_notes: validNotes,
    });

    const checkAndTriggerRefund = async () => {
      let shouldCreateRefund = Boolean(refundOptions?.approveRefund);
      let refundAmount = refundOptions?.refundAmount;
      const codMatch = validNotes.match(/\[COD Manual Reimbursement[^\]]*\]\s*Amount:\s*₹?([0-9]+(?:\.[0-9]+)?)/i);
      if (codMatch && codMatch[1]) {
        shouldCreateRefund = true;
        refundAmount = refundAmount || Number(codMatch[1]);
      }
      if (shouldCreateRefund && refundAmount && refundAmount > 0) {
        try {
          await this.ensureClaimRefund(actor, orderId, claimId, refundAmount, refundOptions?.refundReason || validNotes);
        } catch (refundErr) {
          console.warn('[ADMIN_CLAIM_REFUND_CREATION_WARNING]', refundErr);
        }
      }
    };

    if (!result.error) {
      await checkAndTriggerRefund();
      await this.notifyCustomerClaimDecision(claim, claimId, status);
      return result.data;
    }

    // If RPC is missing in schema cache (PGRST202), execute canonical atomic state transition directly
    if (result.error.code === 'PGRST202' || result.error.message?.includes('schema cache')) {
      const validTransitions: Record<string, string[]> = {
        submitted: ['under_review', 'rejected'],
        under_review: ['approved', 'rejected'],
        approved: ['resolved'],
      };

      if (!validTransitions[claim.status]?.includes(status)) {
        throw new ConflictException(`Invalid claim transition from ${claim.status} to ${status}`);
      }

      const now = new Date().toISOString();
      const updatePayload: Record<string, any> = {
        status,
        resolution_notes: validNotes,
        reviewed_by: actor,
        reviewed_at: now,
        updated_at: now,
      };
      if (status === 'resolved') {
        updatePayload.resolved_at = now;
      }

      const {data: updatedClaim, error: updateErr} = await this.db
        .from('customer_order_claims')
        .update(updatePayload)
        .eq('id', claimId)
        .select()
        .single();

      if (updateErr || !updatedClaim) throw new BadRequestException(updateErr?.message ?? 'Unable to update claim');

      const actionMap: Record<string, string> = {
        under_review: 'claim_review',
        approved: 'claim_approve',
        rejected: 'claim_reject',
        resolved: 'claim_resolve',
      };

      try {
        await this.db.from('admin_issue_decision_audit').insert({
          actor_profile_id: actor,
          order_id: claim.order_id,
          claim_id: claimId,
          action: actionMap[status] || `claim_${status}`,
          notes: validNotes,
          before_status: claim.status,
          after_status: status,
        });
      } catch (auditErr) {
        console.warn('[ADMIN_CLAIM_AUDIT_WARNING]', auditErr);
      }

      await checkAndTriggerRefund();
      await this.notifyCustomerClaimDecision(claim, claimId, status);

      return updatedClaim;
    }

    return this.result(result.data, result.error, 'Unable to update claim');
  }

  private async notifyCustomerClaimDecision(claim: any, claimId: string, status: string) {
    try {
      let customerProfileId: string | null = null;
      if (claim.customer_id) {
        const {data: cust} = await this.db.from('customers').select('profile_id').eq('id', claim.customer_id).maybeSingle();
        customerProfileId = cust?.profile_id || null;
      }
      if (customerProfileId) {
        if (typeof (this.supabase as any)?.createAndBroadcastNotification === 'function') {
          await (this.supabase as any).createAndBroadcastNotification({
            profileId: customerProfileId,
            orderId: claim.order_id,
            notificationType: `claim.${status}`,
            title: 'Claim update',
            body: `Your claim is ${status.replace(/_/g, ' ')}`,
            data: {orderId: claim.order_id, claimId},
            channels: [`customer:${customerProfileId}`, `user:${customerProfileId}`],
          });
        } else {
          await this.db.from('notifications').insert({
            profile_id: customerProfileId,
            order_id: claim.order_id,
            notification_type: `claim.${status}`,
            title: 'Claim update',
            body: `Your claim is ${status.replace(/_/g, ' ')}`,
            data: {orderId: claim.order_id, claimId},
            status: 'queued',
          });
        }
        await this.supabase.broadcastEvent(`customer:${customerProfileId}`, 'CLAIM_UPDATED', {
          orderId: claim.order_id,
          claimId,
          status,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (notifErr) {
      console.warn('[ADMIN_CLAIM_NOTIF_WARNING]', notifErr);
    }
  }

  private async paymentForOrder(orderId: string, paymentId: string) {
    const {data, error} = await this.db.from('payment_orders').select('id,order_id,provider,status')
      .eq('id', paymentId).eq('order_id', orderId).maybeSingle();
    if (data) {
      if (process.env.NODE_ENV !== 'production' && data.provider !== 'mock' && data.provider !== 'razorpay')
        throw new ConflictException('Development refunds require a mock or razorpay payment');
      return {...data, isTransaction: false};
    }
    const {data: tx} = await this.db.from('payment_transactions').select('id,order_id,payment_method,status')
      .eq('id', paymentId).eq('order_id', orderId).maybeSingle();
    if (tx) {
      return {id: tx.id, order_id: tx.order_id, provider: tx.payment_method || 'cod', status: tx.status, isTransaction: true};
    }
    throw new NotFoundException('Payment does not belong to this order');
  }

  async requestRefund(actor: string, orderId: string, paymentId: string, amount: number, reason: string) {
    const payment = await this.paymentForOrder(orderId, paymentId);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001)
      throw new BadRequestException('Enter a positive refund amount in rupees');
    const notes = this.notes(reason);

    if (payment.isTransaction) {
      const {data: refund, error: refundErr} = await this.db.from('refund_requests').insert({
        payment_transaction_id: paymentId,
        amount,
        reason: notes,
        status: 'requested',
        is_cancellation_refund: false,
      }).select().single();

      if (refundErr || !refund) throw new BadRequestException(refundErr?.message ?? 'Unable to request refund');

      try {
        await this.db.from('admin_issue_decision_audit').insert({
          actor_profile_id: actor,
          order_id: orderId,
          refund_id: refund.id,
          action: 'refund_request',
          notes,
          after_status: 'requested',
        });
      } catch (auditErr) {
        console.warn('[ADMIN_REFUND_AUDIT_WARNING]', auditErr);
      }

      try {
        if (typeof (this.supabase as any)?.broadcastEvent === 'function') {
          const payload = {
            eventType: 'REFUND_REQUESTED',
            entityId: refund.id,
            orderId,
            refund,
            timestamp: new Date().toISOString(),
          };
          await this.supabase.broadcastEvent('admin:operations', 'REFUND_REQUESTED', payload);
          await this.supabase.broadcastEvent(`order:${orderId}`, 'REFUND_REQUESTED', payload);
        }
      } catch {}

      return refund;
    }

    const result = await this.db.rpc('admin_request_order_refund_atomic', {
      p_order_id: orderId, p_payment_order_id: paymentId, p_admin_id: actor, p_amount: amount, p_reason: notes,
    });

    if (!result.error) {
      try {
        if (typeof (this.supabase as any)?.broadcastEvent === 'function') {
          const payload = {
            eventType: 'REFUND_REQUESTED',
            entityId: (result.data as any)?.id,
            orderId,
            refund: result.data,
            timestamp: new Date().toISOString(),
          };
          await this.supabase.broadcastEvent('admin:operations', 'REFUND_REQUESTED', payload);
          await this.supabase.broadcastEvent(`order:${orderId}`, 'REFUND_REQUESTED', payload);
        }
      } catch {}
      return result.data;
    }

    if (result.error.code === 'PGRST202' || result.error.message?.includes('schema cache')) {
      const {data: refund, error: refundErr} = await this.db.from('refund_requests').insert({
        payment_order_id: paymentId,
        amount,
        reason: notes,
        status: 'requested',
        is_cancellation_refund: false,
      }).select().single();

      if (refundErr || !refund) throw new BadRequestException(refundErr?.message ?? 'Unable to request refund');

      try {
        await this.db.from('admin_issue_decision_audit').insert({
          actor_profile_id: actor,
          order_id: orderId,
          refund_id: refund.id,
          action: 'refund_request',
          notes,
          after_status: 'requested',
        });
      } catch (auditErr) {
        console.warn('[ADMIN_REFUND_AUDIT_WARNING]', auditErr);
      }

      try {
        if (typeof (this.supabase as any)?.broadcastEvent === 'function') {
          const payload = {
            eventType: 'REFUND_REQUESTED',
            entityId: refund.id,
            orderId,
            refund,
            timestamp: new Date().toISOString(),
          };
          await this.supabase.broadcastEvent('admin:operations', 'REFUND_REQUESTED', payload);
          await this.supabase.broadcastEvent(`order:${orderId}`, 'REFUND_REQUESTED', payload);
        }
      } catch {}

      return refund;
    }

    return this.result(result.data, result.error, 'Unable to request refund');
  }


  private async refundForOrder(orderId: string, refundId: string) {
    const {data, error} = await this.db.from('refund_requests')
      .select('id,payment_order_id,payment_transaction_id,amount,status,reason')
      .eq('id', refundId).maybeSingle();
    if (error || !data) throw new NotFoundException('Refund not found');
    
    if (data.payment_order_id) {
      await this.paymentForOrder(orderId, data.payment_order_id);
    } else if (data.payment_transaction_id) {
      const {data: tx} = await this.db.from('payment_transactions')
        .select('id,order_id')
        .eq('id', data.payment_transaction_id)
        .maybeSingle();
      if (!tx || tx.order_id !== orderId) {
        throw new NotFoundException('Refund does not belong to this order');
      }
    }
    return data;
  }

  async approveRefund(actor: string, orderId: string, refundId: string, notes: string) {
    const refund = await this.refundForOrder(orderId, refundId);
    const validNotes = this.notes(notes);

    if (refund.status === 'approved') {
      return refund;
    }
    if (['completed', 'processed'].includes(refund.status)) {
      return refund;
    }
    if (refund.status === 'rejected') {
      throw new ConflictException('Refund has already been rejected');
    }

    const now = new Date().toISOString();
    const {data: updatedRefund, error} = await this.db
      .from('refund_requests')
      .update({
        status: 'approved',
        approved_by: actor,
        approved_at: now,
      })
      .eq('id', refundId)
      .select()
      .single();

    if (error || !updatedRefund) {
      throw new BadRequestException(error?.message ?? 'Unable to approve refund');
    }

    try {
      await this.db.from('admin_issue_decision_audit').insert({
        actor_profile_id: actor,
        order_id: orderId,
        refund_id: refundId,
        action: 'refund_approve',
        notes: validNotes,
        before_status: refund.status,
        after_status: 'approved',
      });
    } catch (auditErr) {
      console.warn('[ADMIN_REFUND_AUDIT_WARNING]', auditErr);
    }

    try {
      if (typeof (this.supabase as any)?.broadcastEvent === 'function') {
        const payload = {
          eventType: 'REFUND_APPROVED',
          entityId: refundId,
          orderId,
          refund: updatedRefund,
          timestamp: now,
        };
        await this.supabase.broadcastEvent('admin:operations', 'REFUND_APPROVED', payload);
        await this.supabase.broadcastEvent(`order:${orderId}`, 'REFUND_APPROVED', payload);
      }
    } catch (bErr) {
      console.warn('[ADMIN_REFUND_BROADCAST_WARNING]', bErr);
    }

    return updatedRefund;
  }

  async executeRefund(actor: string, orderId: string, refundId: string, notes = 'Executing approved refund') {
    const refund = await this.refundForOrder(orderId, refundId);
    const validNotes = this.notes(notes);

    if (['completed', 'processed'].includes(refund.status)) {
      return { refundId, status: refund.status, duplicate: true };
    }
    if (refund.status !== 'approved' && refund.status !== 'processing' && refund.status !== 'failed') {
      throw new ConflictException(`Refund must be approved before execution (current status: ${refund.status})`);
    }

    const now = new Date().toISOString();

    if (refund.payment_order_id) {
      try {
        const result = await this.payments.approveRefund(actor, refundId, validNotes);
        return result;
      } catch (err: any) {
        const isUnconfigured = err?.message?.includes('credentials are not configured') || err?.status === 503;
        const targetStatus = isUnconfigured ? 'approved' : 'failed';

        await this.db.from('refund_requests')
          .update({ status: targetStatus, processed_at: now })
          .eq('id', refundId);

        try {
          await this.db.from('admin_issue_decision_audit').insert({
            actor_profile_id: actor,
            order_id: orderId,
            refund_id: refundId,
            action: isUnconfigured ? 'refund_execution_deferred' : 'refund_execution_failed',
            notes: `${validNotes} [Result: ${err?.message || 'Provider execution error'}]`,
            before_status: refund.status,
            after_status: targetStatus,
          });
        } catch {}

        if (isUnconfigured) {
          return {
            refundId,
            status: 'approved',
            duplicate: false,
            message: 'Refund remains approved; provider credentials not configured for direct auto-settlement.',
          };
        }
        throw err;
      }
    }

    const { data: completedRefund, error } = await this.db
      .from('refund_requests')
      .update({
        status: 'completed',
        processed_at: now,
      })
      .eq('id', refundId)
      .select()
      .single();

    if (error || !completedRefund) {
      throw new BadRequestException(error?.message ?? 'Unable to complete reimbursement');
    }

    try {
      await this.db.from('admin_issue_decision_audit').insert({
        actor_profile_id: actor,
        order_id: orderId,
        refund_id: refundId,
        action: 'refund_execute_cod',
        notes: validNotes,
        before_status: refund.status,
        after_status: 'completed',
      });
    } catch {}

    try {
      if (typeof (this.supabase as any)?.broadcastEvent === 'function') {
        const payload = {
          eventType: 'REFUND_COMPLETED',
          entityId: refundId,
          orderId,
          refund: completedRefund,
          timestamp: now,
        };
        await this.supabase.broadcastEvent('admin:operations', 'REFUND_COMPLETED', payload);
        await this.supabase.broadcastEvent(`order:${orderId}`, 'REFUND_COMPLETED', payload);
      }
    } catch {}

    return completedRefund;
  }

  async rejectRefund(actor: string, orderId: string, refundId: string, notes: string) {
    const refund = await this.refundForOrder(orderId, refundId);
    const validNotes = this.notes(notes);
    const result = await this.db.rpc('admin_reject_refund_atomic', {
      p_refund_id: refundId, p_admin_id: actor, p_notes: validNotes,
    });

    if (!result.error) {
      return result.data;
    }

    if (result.error.code === 'PGRST202' || result.error.message?.includes('schema cache')) {
      if (!['requested', 'under_review'].includes(refund.status)) {
        throw new ConflictException('Refund can no longer be rejected');
      }

      const now = new Date().toISOString();
      const {data: updatedRefund, error: updateErr} = await this.db
        .from('refund_requests')
        .update({
          status: 'rejected',
          rejected_by: actor,
          rejected_at: now,
          decision_notes: validNotes,
        })
        .eq('id', refundId)
        .select()
        .single();

      if (updateErr || !updatedRefund) throw new BadRequestException(updateErr?.message ?? 'Unable to reject refund');

      try {
        await this.db.from('admin_issue_decision_audit').insert({
          actor_profile_id: actor,
          order_id: orderId,
          refund_id: refundId,
          action: 'refund_reject',
          notes: validNotes,
          before_status: refund.status,
          after_status: 'rejected',
        });
      } catch (auditErr) {
        console.warn('[ADMIN_REFUND_AUDIT_WARNING]', auditErr);
      }

      return updatedRefund;
    }

    return this.result(result.data, result.error, 'Unable to reject refund');
  }
}

