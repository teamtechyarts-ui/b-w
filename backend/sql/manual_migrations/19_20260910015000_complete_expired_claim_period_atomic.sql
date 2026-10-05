-- Runtime Gate 6: complete an expired delivery claim period atomically.
--
-- This service-role-only function locks the order before checking its
-- deadline. The deadline validation and the existing C2 lifecycle transition
-- therefore happen in one transaction without a time-of-check/time-of-use
-- race. The change_order_status function and its grants remain unchanged.

CREATE OR REPLACE FUNCTION public.complete_expired_claim_period(
    p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status public.order_status;
    v_claim_deadline_at timestamptz;
    v_now timestamptz := transaction_timestamp();
BEGIN
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'Order is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT
        o.current_status,
        o.claim_deadline_at
    INTO
        v_order_status,
        v_claim_deadline_at
    FROM public.orders AS o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order_status <> 'claim_period_active'::public.order_status THEN
        RAISE EXCEPTION
            'Order cannot complete while it is %',
            v_order_status
            USING ERRCODE = '23514';
    END IF;

    IF v_claim_deadline_at IS NULL THEN
        RAISE EXCEPTION 'Order has no claim-period deadline'
            USING ERRCODE = '23514';
    END IF;

    IF v_claim_deadline_at > v_now THEN
        RAISE EXCEPTION 'The delivery claim period is still active'
            USING ERRCODE = '23514';
    END IF;

    PERFORM public.change_order_status(
        p_order_id,
        'completed'::public.order_status,
        'Delivery claim period elapsed'
    );

    RETURN jsonb_build_object(
        'orderId', p_order_id,
        'orderStatus', 'completed',
        'claimDeadlineAt', v_claim_deadline_at,
        'completedAt', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_expired_claim_period(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_expired_claim_period(uuid)
TO service_role;

COMMENT ON FUNCTION public.complete_expired_claim_period(uuid)
IS 'Locks an order, verifies that its delivery claim deadline elapsed, and completes it through the C2 lifecycle function.';
