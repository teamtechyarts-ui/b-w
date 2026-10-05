-- An Admin cancellation uses the existing atomic customer cancellation and
-- refund workflow. This wrapper authenticates the privileged actor and fixes
-- the history attribution in the same database transaction.
CREATE OR REPLACE FUNCTION public.cancel_order_by_admin_atomic(
    p_order_id uuid, p_admin_profile_id uuid, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_customer_profile_id uuid;
    v_previous_status public.order_status;
    v_result jsonb;
BEGIN
    IF NOT public.is_admin(p_admin_profile_id) THEN
        RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
    END IF;
    SELECT customer.profile_id, orders.current_status
      INTO v_customer_profile_id, v_previous_status
      FROM public.orders AS orders
      JOIN public.customers AS customer ON customer.id = orders.customer_id
     WHERE orders.id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
    END IF;
    v_result := public.cancel_customer_order_atomic(p_order_id, v_customer_profile_id, p_reason);
    IF COALESCE((v_result->>'duplicate')::boolean, false) THEN
        RAISE EXCEPTION 'Order already cancelled' USING ERRCODE = '23514';
    END IF;
    UPDATE public.order_status_history AS history
       SET changed_by = p_admin_profile_id,
           reason = 'Admin cancellation: ' || btrim(p_reason)
     WHERE history.id = (
       SELECT candidate.id FROM public.order_status_history AS candidate
       WHERE candidate.order_id = p_order_id
         AND candidate.from_status = v_previous_status
         AND candidate.to_status = 'cancelled'::public.order_status
         AND candidate.reason = 'Customer cancellation: ' || btrim(p_reason)
       ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
     );
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cancellation audit missing' USING ERRCODE = '23514';
    END IF;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_order_by_admin_atomic(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_by_admin_atomic(uuid, uuid, text) TO service_role;
