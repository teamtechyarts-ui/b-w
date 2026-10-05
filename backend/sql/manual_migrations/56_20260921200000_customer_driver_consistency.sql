-- Keep loyalty value and customer refund eligibility server-authoritative.
ALTER TABLE public.admin_growth_settings
  ALTER COLUMN loyalty_points_per_rupee SET DEFAULT 10,
  ALTER COLUMN loyalty_minimum_redemption_rupees SET DEFAULT 100;

UPDATE public.admin_growth_settings
SET loyalty_points_per_rupee = 10,
    loyalty_minimum_redemption_rupees = 100
WHERE id = true;

CREATE OR REPLACE FUNCTION public.request_refund_atomic(
    p_payment_order_id uuid,
    p_requested_by uuid,
    p_amount numeric,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment public.payment_orders%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_refund public.refund_requests%ROWTYPE;
    v_committed numeric(12,2);
    v_reason text;
BEGIN
    v_reason := btrim(COALESCE(p_reason, ''));
    IF p_payment_order_id IS NULL OR p_requested_by IS NULL THEN
        RAISE EXCEPTION 'Payment and requester are required' USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Refund amount is invalid' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Refund reason must contain between 3 and 500 characters' USING ERRCODE = '22023';
    END IF;

    SELECT payment.* INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = p_payment_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order % not found', p_payment_order_id USING ERRCODE = 'P0002';
    END IF;

    SELECT orders.* INTO v_order
    FROM public.orders
    WHERE orders.id = v_payment.order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_payment.order_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.customers AS customer
        WHERE customer.id = v_order.customer_id
          AND customer.profile_id = p_requested_by
    ) THEN
        RAISE EXCEPTION 'Payment belongs to another customer' USING ERRCODE = '42501';
    END IF;
    IF v_payment.status NOT IN ('paid', 'partially_refunded') OR v_payment.provider_payment_id IS NULL THEN
        RAISE EXCEPTION 'Only a captured payment can be refunded' USING ERRCODE = '23514';
    END IF;
    IF v_order.current_status NOT IN (
        'cancelled'::public.order_status,
        'claim_period_active'::public.order_status
    ) THEN
        RAISE EXCEPTION 'Order is not eligible for a refund request' USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(sum(refund.amount), 0) INTO v_committed
    FROM public.refund_requests AS refund
    WHERE refund.payment_order_id = v_payment.id
      AND refund.status IN (
          'requested'::public.refund_status,
          'under_review'::public.refund_status,
          'approved'::public.refund_status,
          'processing'::public.refund_status,
          'completed'::public.refund_status
      );
    IF p_amount + v_committed > v_payment.amount THEN
        RAISE EXCEPTION 'Refund exceeds the remaining captured amount' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.refund_requests (
        payment_order_id, requested_by, amount, reason, status, is_cancellation_refund
    ) VALUES (
        v_payment.id, p_requested_by, p_amount, v_reason, 'requested'::public.refund_status, false
    ) RETURNING * INTO v_refund;
    RETURN to_jsonb(v_refund);
END;
$$;

REVOKE ALL ON FUNCTION public.request_refund_atomic(uuid, uuid, numeric, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_refund_atomic(uuid, uuid, numeric, text)
TO service_role;
