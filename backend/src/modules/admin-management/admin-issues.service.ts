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
      this.db.from('refund_requests').select('id,payment_order_id,amount,reason,status,is_cancellation_refund,created_at,payment_orders(order_id)')
        .order('created_at', {ascending: false}).limit(100),
      this.db.from('orders').select('id,order_number,current_status,updated_at').eq('current_status', 'cancelled')
        .order('updated_at', {ascending: false}).limit(100),
    ]);
    if (claims.error || refunds.error || cancellations.error) throw new BadRequestException('Unable to load customer issues');
    return {claims: claims.data ?? [], refunds: refunds.data ?? [], cancellations: cancellations.data ?? []};
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
            console.log('[CLAIM_PHOTO_READ]', {
              claimId: claim.id,
              photoId: photo.id,
              storagePath: photo.storage_path,
              signedUrlGenerated: false,
              expiresIn: 3600,
              supabaseError: 'Storage client not available',
            });
            return {...photo, signedUrl: null};
          }
          const signed = await this.db.storage.from('customer-claim-photos').createSignedUrl(photo.storage_path, 3600);
          const signedUrl = signed.data?.signedUrl ?? null;
          console.log('[CLAIM_PHOTO_READ]', {
            claimId: claim.id,
            photoId: photo.id,
            storagePath: photo.storage_path,
            signedUrlGenerated: Boolean(signedUrl),
            expiresIn: 3600,
            supabaseError: signed.error?.message ?? null,
          });
          return {...photo, signedUrl};
        } catch (err: any) {
          console.log('[CLAIM_PHOTO_READ]', {
            claimId: claim.id,
            photoId: photo.id,
            storagePath: photo.storage_path,
            signedUrlGenerated: false,
            expiresIn: 3600,
            supabaseError: err?.message ?? 'Unknown storage error',
          });
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
    return {order, claims: evidence, payments: paymentRows, cancellationHistory: cancellation.data ?? [], audit: audit.data ?? []};
  }

  async claimDecision(actor: string, orderId: string, claimId: string, status: string, notes: string) {
    const validNotes = this.notes(notes);
    const {data: claim, error} = await this.db.from('customer_order_claims').select('*')
      .eq('id', claimId).eq('order_id', orderId).maybeSingle();
    if (error || !claim) throw new NotFoundException('Claim does not belong to this order');

    const result = await this.db.rpc('admin_review_customer_claim_atomic', {
      p_claim_id: claimId, p_admin_id: actor, p_target_status: status, p_notes: validNotes,
    });

    if (!result.error) {
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

      try {
        let customerProfileId: string | null = null;
        if (claim.customer_id) {
          const {data: cust} = await this.db.from('customers').select('profile_id').eq('id', claim.customer_id).maybeSingle();
          customerProfileId = cust?.profile_id || null;
        }
        if (customerProfileId) {
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
      } catch (notifErr) {
        console.warn('[ADMIN_CLAIM_NOTIF_WARNING]', notifErr);
      }

      return updatedClaim;
    }

    return this.result(result.data, result.error, 'Unable to update claim');
  }

  private async paymentForOrder(orderId: string, paymentId: string) {
    const {data, error} = await this.db.from('payment_orders').select('id,order_id,provider,status')
      .eq('id', paymentId).eq('order_id', orderId).maybeSingle();
    if (error || !data) throw new NotFoundException('Payment does not belong to this order');
    if (process.env.NODE_ENV !== 'production' && data.provider !== 'mock' && data.provider !== 'razorpay')
      throw new ConflictException('Development refunds require a mock or razorpay payment');
    return data;
  }

  async requestRefund(actor: string, orderId: string, paymentId: string, amount: number, reason: string) {
    await this.paymentForOrder(orderId, paymentId);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001)
      throw new BadRequestException('Enter a positive refund amount in rupees');
    const notes = this.notes(reason);
    const result = await this.db.rpc('admin_request_order_refund_atomic', {
      p_order_id: orderId, p_payment_order_id: paymentId, p_admin_id: actor, p_amount: amount, p_reason: notes,
    });

    if (!result.error) {
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

      return refund;
    }

    return this.result(result.data, result.error, 'Unable to request refund');
  }

  private async refundForOrder(orderId: string, refundId: string) {
    const {data, error} = await this.db.from('refund_requests').select('id,payment_order_id,status')
      .eq('id', refundId).maybeSingle();
    if (error || !data) throw new NotFoundException('Refund not found');
    await this.paymentForOrder(orderId, data.payment_order_id);
    return data;
  }

  async approveRefund(actor: string, orderId: string, refundId: string, notes: string) {
    await this.refundForOrder(orderId, refundId);
    return this.payments.approveRefund(actor, refundId, this.notes(notes));
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
