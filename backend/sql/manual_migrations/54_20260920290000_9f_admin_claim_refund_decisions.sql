CREATE TABLE public.admin_issue_decision_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  claim_id uuid REFERENCES public.customer_order_claims(id),
  refund_id uuid REFERENCES public.refund_requests(id),
  action text NOT NULL CHECK (action IN ('claim_review','claim_approve','claim_reject','claim_resolve','refund_request','refund_approve','refund_reject')),
  notes text NOT NULL,
  before_status text,
  after_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_issue_decision_audit_order_time ON public.admin_issue_decision_audit(order_id,created_at DESC);
ALTER TABLE public.admin_issue_decision_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_issue_decision_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.admin_issue_decision_audit TO service_role;
CREATE TRIGGER admin_issue_decision_audit_immutable BEFORE UPDATE OR DELETE ON public.admin_issue_decision_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS decision_notes text;

CREATE FUNCTION public.admin_review_customer_claim_atomic(p_claim_id uuid,p_admin_id uuid,p_target_status text,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_claim public.customer_order_claims%ROWTYPE; v_customer_profile uuid; v_previous_status text; v_notes text:=btrim(coalesce(p_notes,''));
BEGIN
  IF NOT public.is_admin(p_admin_id) THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF length(v_notes) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Decision notes must contain 3 to 1000 characters' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_claim FROM public.customer_order_claims WHERE id=p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found' USING ERRCODE='P0002'; END IF;
  IF NOT ((v_claim.status='submitted' AND p_target_status IN ('under_review','rejected')) OR
    (v_claim.status='under_review' AND p_target_status IN ('approved','rejected')) OR
    (v_claim.status='approved' AND p_target_status='resolved')) THEN
    RAISE EXCEPTION 'Invalid claim transition from % to %',v_claim.status,p_target_status USING ERRCODE='23514'; END IF;
  v_previous_status:=v_claim.status;
  UPDATE public.customer_order_claims SET status=p_target_status,resolution_notes=v_notes,reviewed_by=p_admin_id,
    reviewed_at=transaction_timestamp(),resolved_at=CASE WHEN p_target_status='resolved' THEN transaction_timestamp() ELSE resolved_at END,
    updated_at=transaction_timestamp() WHERE id=p_claim_id RETURNING * INTO v_claim;
  INSERT INTO public.admin_issue_decision_audit(actor_profile_id,order_id,claim_id,action,notes,before_status,after_status)
    VALUES(p_admin_id,v_claim.order_id,p_claim_id,'claim_'||CASE p_target_status WHEN 'under_review' THEN 'review' WHEN 'approved' THEN 'approve' WHEN 'rejected' THEN 'reject' ELSE 'resolve' END,
      v_notes,v_previous_status,p_target_status);
  SELECT profile_id INTO v_customer_profile FROM public.customers WHERE id=v_claim.customer_id;
  INSERT INTO public.notifications(profile_id,order_id,notification_type,title,body,data,status)
    VALUES(v_customer_profile,v_claim.order_id,'claim.'||p_target_status,'Claim update',
      format('Your claim is %s',replace(p_target_status,'_',' ')),jsonb_build_object('orderId',v_claim.order_id::text,'claimId',p_claim_id::text), 'queued');
  RETURN to_jsonb(v_claim);
END; $$;

CREATE FUNCTION public.admin_request_order_refund_atomic(p_order_id uuid,p_payment_order_id uuid,p_admin_id uuid,p_amount numeric,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_customer_profile uuid; v_refund jsonb; v_notes text:=btrim(coalesce(p_reason,''));
BEGIN
  IF NOT public.is_admin(p_admin_id) THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  SELECT c.profile_id INTO v_customer_profile FROM public.payment_orders po JOIN public.orders o ON o.id=po.order_id
    JOIN public.customers c ON c.id=o.customer_id WHERE po.id=p_payment_order_id AND o.id=p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment does not belong to order' USING ERRCODE='P0002'; END IF;
  v_refund:=public.request_refund_atomic(p_payment_order_id,v_customer_profile,p_amount,v_notes);
  INSERT INTO public.admin_issue_decision_audit(actor_profile_id,order_id,refund_id,action,notes,after_status)
    VALUES(p_admin_id,p_order_id,(v_refund->>'id')::uuid,'refund_request',v_notes,'requested');
  INSERT INTO public.notifications(profile_id,order_id,notification_type,title,body,data,status)
    VALUES(v_customer_profile,p_order_id,'refund.requested','Refund update','A refund was requested for your order',
      jsonb_build_object('orderId',p_order_id::text,'refundId',v_refund->>'id'),'queued');
  RETURN v_refund;
END; $$;

CREATE FUNCTION public.admin_claim_refund_approval_audited_atomic(p_refund_id uuid,p_admin_id uuid,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb; v_order_id uuid; v_customer_profile uuid; v_notes text:=btrim(coalesce(p_notes,''));
BEGIN
  IF length(v_notes) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Decision notes must contain 3 to 1000 characters' USING ERRCODE='22023'; END IF;
  v_result:=public.claim_refund_approval_atomic(p_refund_id,p_admin_id);
  IF coalesce((v_result->>'claimed')::boolean,false) THEN
    SELECT o.id,c.profile_id INTO v_order_id,v_customer_profile FROM public.refund_requests rr
      JOIN public.payment_orders po ON po.id=rr.payment_order_id JOIN public.orders o ON o.id=po.order_id
      JOIN public.customers c ON c.id=o.customer_id WHERE rr.id=p_refund_id;
    UPDATE public.refund_requests SET decision_notes=v_notes WHERE id=p_refund_id;
    INSERT INTO public.admin_issue_decision_audit(actor_profile_id,order_id,refund_id,action,notes,before_status,after_status)
      VALUES(p_admin_id,v_order_id,p_refund_id,'refund_approve',v_notes,'requested','approved');
    INSERT INTO public.notifications(profile_id,order_id,notification_type,title,body,data,status)
      VALUES(v_customer_profile,v_order_id,'refund.approved','Refund update','Your refund was approved',
        jsonb_build_object('orderId',v_order_id::text,'refundId',p_refund_id::text),'queued');
  END IF;
  RETURN v_result;
END; $$;

CREATE FUNCTION public.admin_reject_refund_atomic(p_refund_id uuid,p_admin_id uuid,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_refund public.refund_requests%ROWTYPE; v_order_id uuid; v_customer_profile uuid; v_previous_status text; v_notes text:=btrim(coalesce(p_notes,''));
BEGIN
  IF NOT public.is_admin(p_admin_id) THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
  IF length(v_notes) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Decision notes must contain 3 to 1000 characters' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_refund FROM public.refund_requests WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found' USING ERRCODE='P0002'; END IF;
  IF v_refund.status NOT IN ('requested','under_review') THEN RAISE EXCEPTION 'Refund can no longer be rejected' USING ERRCODE='23514'; END IF;
  v_previous_status:=v_refund.status;
  SELECT o.id,c.profile_id INTO v_order_id,v_customer_profile FROM public.payment_orders po
    JOIN public.orders o ON o.id=po.order_id JOIN public.customers c ON c.id=o.customer_id WHERE po.id=v_refund.payment_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment order not found' USING ERRCODE='P0002'; END IF;
  UPDATE public.refund_requests SET status='rejected',rejected_by=p_admin_id,rejected_at=transaction_timestamp(),decision_notes=v_notes
    WHERE id=p_refund_id RETURNING * INTO v_refund;
  INSERT INTO public.admin_issue_decision_audit(actor_profile_id,order_id,refund_id,action,notes,before_status,after_status)
    VALUES(p_admin_id,v_order_id,p_refund_id,'refund_reject',v_notes,v_previous_status,'rejected');
  INSERT INTO public.notifications(profile_id,order_id,notification_type,title,body,data,status)
    VALUES(v_customer_profile,v_order_id,'refund.rejected','Refund update','Your refund request was declined',
      jsonb_build_object('orderId',v_order_id::text,'refundId',p_refund_id::text),'queued');
  RETURN to_jsonb(v_refund);
END; $$;

REVOKE ALL ON FUNCTION public.admin_review_customer_claim_atomic(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_request_order_refund_atomic(uuid,uuid,uuid,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_claim_refund_approval_audited_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_reject_refund_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_customer_claim_atomic(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_request_order_refund_atomic(uuid,uuid,uuid,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_claim_refund_approval_audited_atomic(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_refund_atomic(uuid,uuid,text) TO service_role;
