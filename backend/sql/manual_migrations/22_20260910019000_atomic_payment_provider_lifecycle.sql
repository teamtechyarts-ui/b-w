-- Keep payment confirmation, webhook replay handling, and refund accounting
-- transactionally consistent. Provider network calls remain in Nest; these
-- service-role-only functions own the Bright & White database effects.

ALTER TABLE public.payment_webhook_events
ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.payment_transactions
        WHERE payment_order_id IS NOT NULL
          AND transaction_type IS NOT NULL
          AND provider_reference IS NOT NULL
        GROUP BY payment_order_id, transaction_type, provider_reference
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate provider payment transactions must be reconciled before payment lifecycle hardening'
            USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.payment_orders
        WHERE status IN ('created', 'authorized', 'paid')
        GROUP BY order_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate active payment orders must be reconciled before payment lifecycle hardening'
            USING ERRCODE = '23505';
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_transactions_provider_reference
ON public.payment_transactions (
    payment_order_id,
    transaction_type,
    provider_reference
)
WHERE payment_order_id IS NOT NULL
  AND transaction_type IS NOT NULL
  AND provider_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_one_active_per_order
ON public.payment_orders (order_id)
WHERE status IN ('created', 'authorized', 'paid');

CREATE OR REPLACE FUNCTION public.record_captured_payment_atomic(
    p_payment_order_id uuid,
    p_provider_payment_id text,
    p_provider_status text,
    p_provider_payload jsonb DEFAULT '{}'::jsonb,
    p_actor_profile_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment public.payment_orders%ROWTYPE;
    v_order_status public.order_status;
    v_duplicate boolean;
    v_reason text;
    v_rows integer;
BEGIN
    IF p_payment_order_id IS NULL
       OR p_provider_payment_id IS NULL
       OR btrim(p_provider_payment_id) = ''
       OR p_provider_status <> 'captured' THEN
        RAISE EXCEPTION 'A captured provider payment is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT payment.*
    INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order % not found', p_payment_order_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT orders.current_status
    INTO v_order_status
    FROM public.orders
    WHERE orders.id = v_payment.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', v_payment.order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_payment.status = 'paid'
       AND v_payment.provider_payment_id IS DISTINCT FROM p_provider_payment_id THEN
        RAISE EXCEPTION 'Payment order is already paid by another payment'
            USING ERRCODE = '23514';
    END IF;

    IF v_payment.status NOT IN ('created', 'authorized', 'failed', 'paid') THEN
        RAISE EXCEPTION 'Payment cannot be captured while it is %', v_payment.status
            USING ERRCODE = '23514';
    END IF;

    v_duplicate := v_payment.status = 'paid';

    IF NOT v_duplicate AND v_order_status <> 'pending_payment'::public.order_status THEN
        RAISE EXCEPTION 'Order is not awaiting payment'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.payment_orders
    SET
        status = 'paid',
        provider_payment_id = p_provider_payment_id,
        paid_at = COALESCE(paid_at, transaction_timestamp()),
        updated_at = transaction_timestamp()
    WHERE id = v_payment.id;

    INSERT INTO public.payment_transactions (
        payment_order_id,
        order_id,
        provider,
        provider_order_id,
        provider_payment_id,
        transaction_type,
        amount,
        currency,
        status,
        provider_reference,
        provider_payload,
        verified_at,
        processed_at
    )
    VALUES (
        v_payment.id,
        v_payment.order_id,
        v_payment.provider,
        v_payment.provider_order_id,
        p_provider_payment_id,
        'payment',
        v_payment.amount,
        v_payment.currency,
        'paid',
        p_provider_payment_id,
        COALESCE(p_provider_payload, '{}'::jsonb)
            || jsonb_build_object('status', p_provider_status),
        transaction_timestamp(),
        transaction_timestamp()
    )
    ON CONFLICT (
        payment_order_id,
        transaction_type,
        provider_reference
    ) WHERE payment_order_id IS NOT NULL
          AND transaction_type IS NOT NULL
          AND provider_reference IS NOT NULL
    DO NOTHING;

    IF v_order_status = 'pending_payment'::public.order_status THEN
        v_reason := format(
            'Provider payment captured (%s)',
            p_provider_payment_id
        );

        PERFORM public.change_order_status(
            v_payment.order_id,
            'confirmed'::public.order_status,
            v_reason
        );

        IF p_actor_profile_id IS NOT NULL THEN
            UPDATE public.order_status_history AS history
            SET changed_by = p_actor_profile_id
            WHERE history.order_id = v_payment.order_id
              AND history.from_status = 'pending_payment'::public.order_status
              AND history.to_status = 'confirmed'::public.order_status
              AND history.reason = v_reason;

            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows <> 1 THEN
                RAISE EXCEPTION 'Payment status history was not recorded'
                    USING ERRCODE = '40001';
            END IF;
        END IF;

        v_order_status := 'confirmed'::public.order_status;
    END IF;

    RETURN jsonb_build_object(
        'paymentOrderId', v_payment.id,
        'orderId', v_payment.order_id,
        'orderStatus', v_order_status,
        'duplicate', v_duplicate
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_failed_payment_atomic(
    p_payment_order_id uuid,
    p_provider_payment_id text,
    p_provider_status text,
    p_provider_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment public.payment_orders%ROWTYPE;
    v_duplicate boolean;
BEGIN
    IF p_payment_order_id IS NULL
       OR p_provider_payment_id IS NULL
       OR btrim(p_provider_payment_id) = ''
       OR p_provider_status <> 'failed' THEN
        RAISE EXCEPTION 'A failed provider payment is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT payment.*
    INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order % not found', p_payment_order_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_payment.status = 'paid' THEN
        RAISE EXCEPTION 'A paid payment cannot be marked failed'
            USING ERRCODE = '23514';
    END IF;

    IF v_payment.status NOT IN ('created', 'authorized', 'failed') THEN
        RAISE EXCEPTION 'Payment cannot fail while it is %', v_payment.status
            USING ERRCODE = '23514';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.payment_transactions AS transaction
        WHERE transaction.payment_order_id = v_payment.id
          AND transaction.transaction_type = 'payment'
          AND transaction.provider_reference = p_provider_payment_id
    ) INTO v_duplicate;

    UPDATE public.payment_orders
    SET
        status = 'failed',
        provider_payment_id = p_provider_payment_id,
        updated_at = transaction_timestamp()
    WHERE id = v_payment.id;

    INSERT INTO public.payment_transactions (
        payment_order_id,
        order_id,
        provider,
        provider_order_id,
        provider_payment_id,
        transaction_type,
        amount,
        currency,
        status,
        provider_reference,
        provider_payload,
        verified_at,
        processed_at
    )
    VALUES (
        v_payment.id,
        v_payment.order_id,
        v_payment.provider,
        v_payment.provider_order_id,
        p_provider_payment_id,
        'payment',
        v_payment.amount,
        v_payment.currency,
        'failed',
        p_provider_payment_id,
        COALESCE(p_provider_payload, '{}'::jsonb)
            || jsonb_build_object('status', p_provider_status),
        transaction_timestamp(),
        transaction_timestamp()
    )
    ON CONFLICT (
        payment_order_id,
        transaction_type,
        provider_reference
    ) WHERE payment_order_id IS NOT NULL
          AND transaction_type IS NOT NULL
          AND provider_reference IS NOT NULL
    DO NOTHING;

    RETURN jsonb_build_object(
        'paymentOrderId', v_payment.id,
        'orderId', v_payment.order_id,
        'orderStatus', (
            SELECT orders.current_status
            FROM public.orders
            WHERE orders.id = v_payment.order_id
        ),
        'duplicate', v_duplicate
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_payment_webhook_event_atomic(
    p_provider text,
    p_external_event_id text,
    p_event_type text,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_event public.payment_webhook_events%ROWTYPE;
    v_claimed boolean := false;
    v_duplicate boolean := false;
BEGIN
    IF p_provider IS NULL OR btrim(p_provider) = ''
       OR p_external_event_id IS NULL OR btrim(p_external_event_id) = ''
       OR p_event_type IS NULL OR btrim(p_event_type) = '' THEN
        RAISE EXCEPTION 'Provider webhook identity is required'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.payment_webhook_events (
        provider,
        external_event_id,
        provider_event_id,
        event_type,
        payload,
        processing_status,
        processing_started_at
    )
    VALUES (
        p_provider,
        p_external_event_id,
        p_external_event_id,
        p_event_type,
        COALESCE(p_payload, '{}'::jsonb),
        'processing',
        transaction_timestamp()
    )
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_event;

    IF FOUND THEN
        v_claimed := true;
    ELSE
        SELECT event.*
        INTO v_event
        FROM public.payment_webhook_events AS event
        WHERE event.provider = p_provider
          AND event.external_event_id = p_external_event_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Webhook event identity conflicts with another provider'
                USING ERRCODE = '23505';
        END IF;

        IF v_event.processing_status = 'processed' THEN
            v_duplicate := true;
        ELSIF v_event.processing_status IN ('failed', 'pending')
           OR (
               v_event.processing_status = 'processing'
               AND COALESCE(
                   v_event.processing_started_at,
                   v_event.created_at
               ) <= statement_timestamp() - interval '5 minutes'
           ) THEN
            UPDATE public.payment_webhook_events
            SET
                event_type = p_event_type,
                payload = COALESCE(p_payload, '{}'::jsonb),
                processing_status = 'processing',
                processing_started_at = transaction_timestamp(),
                processed_at = NULL
            WHERE id = v_event.id
            RETURNING * INTO v_event;
            v_claimed := true;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'eventId', v_event.id,
        'claimed', v_claimed,
        'duplicate', v_duplicate,
        'processingStatus', v_event.processing_status
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_payment_webhook_event_atomic(
    p_event_id uuid,
    p_succeeded boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.payment_webhook_events
    SET
        processing_status = CASE WHEN p_succeeded THEN 'processed' ELSE 'failed' END,
        processed_at = CASE WHEN p_succeeded THEN transaction_timestamp() ELSE NULL END,
        processing_started_at = NULL
    WHERE id = p_event_id
      AND processing_status = 'processing';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Webhook event is not being processed'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_refund_approval_atomic(
    p_refund_id uuid,
    p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_refund public.refund_requests%ROWTYPE;
    v_payment public.payment_orders%ROWTYPE;
    v_committed numeric(12,2);
    v_claimed boolean := false;
BEGIN
    IF p_refund_id IS NULL OR p_admin_id IS NULL THEN
        RAISE EXCEPTION 'Refund and administrator are required'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profile_roles AS profile_role
        JOIN public.roles AS role ON role.id = profile_role.role_id
        WHERE profile_role.profile_id = p_admin_id
          AND role.code = 'admin'
    ) THEN
        RAISE EXCEPTION 'Administrator access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT refund.*
    INTO v_refund
    FROM public.refund_requests AS refund
    WHERE refund.id = p_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund request % not found', p_refund_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT payment.*
    INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = v_refund.payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order for refund was not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_payment.status NOT IN ('paid', 'partially_refunded')
       OR v_payment.provider_payment_id IS NULL THEN
        RAISE EXCEPTION 'Only a captured payment can be refunded'
            USING ERRCODE = '23514';
    END IF;

    IF v_refund.status = 'requested' THEN
        SELECT COALESCE(sum(other.amount), 0)
        INTO v_committed
        FROM public.refund_requests AS other
        WHERE other.payment_order_id = v_payment.id
          AND other.id <> v_refund.id
          AND other.status IN ('approved', 'processing', 'completed');

        IF v_refund.amount + v_committed > v_payment.amount THEN
            RAISE EXCEPTION 'Refund exceeds the remaining captured amount'
                USING ERRCODE = '23514';
        END IF;

        UPDATE public.refund_requests
        SET
            status = 'approved',
            approved_by = p_admin_id,
            approved_at = COALESCE(approved_at, transaction_timestamp())
        WHERE id = v_refund.id
        RETURNING * INTO v_refund;

        v_claimed := true;
    ELSIF v_refund.status NOT IN ('approved', 'processing', 'completed') THEN
        RAISE EXCEPTION 'Refund cannot be approved while it is %', v_refund.status
            USING ERRCODE = '23514';
    END IF;

    RETURN jsonb_build_object(
        'refundId', v_refund.id,
        'paymentOrderId', v_payment.id,
        'providerPaymentId', v_payment.provider_payment_id,
        'amount', v_refund.amount,
        'currency', v_payment.currency,
        'claimed', v_claimed,
        'status', v_refund.status,
        'providerRefundId', v_refund.provider_refund_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_provider_refund_atomic(
    p_refund_id uuid,
    p_provider_refund_id text,
    p_provider_status text,
    p_provider_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_refund public.refund_requests%ROWTYPE;
    v_payment public.payment_orders%ROWTYPE;
    v_target_status public.refund_status;
    v_duplicate boolean;
    v_refunded numeric(12,2);
BEGIN
    IF p_refund_id IS NULL
       OR p_provider_refund_id IS NULL
       OR btrim(p_provider_refund_id) = '' THEN
        RAISE EXCEPTION 'Provider refund identity is required'
            USING ERRCODE = '22023';
    END IF;

    v_target_status := CASE
        WHEN p_provider_status IN ('processed', 'completed') THEN 'completed'::public.refund_status
        WHEN p_provider_status = 'failed' THEN 'failed'::public.refund_status
        ELSE 'processing'::public.refund_status
    END;

    SELECT refund.*
    INTO v_refund
    FROM public.refund_requests AS refund
    WHERE refund.id = p_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund request % not found', p_refund_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_refund.status NOT IN ('approved', 'processing', 'completed', 'failed') THEN
        RAISE EXCEPTION 'Refund has not been claimed for provider processing'
            USING ERRCODE = '23514';
    END IF;

    IF v_refund.provider_refund_id IS NOT NULL
       AND v_refund.provider_refund_id <> p_provider_refund_id THEN
        RAISE EXCEPTION 'Refund already has another provider reference'
            USING ERRCODE = '23514';
    END IF;

    v_duplicate := v_refund.provider_refund_id = p_provider_refund_id
        AND v_refund.status = v_target_status;

    SELECT payment.*
    INTO v_payment
    FROM public.payment_orders AS payment
    WHERE payment.id = v_refund.payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order for refund was not found'
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.refund_requests
    SET
        status = v_target_status,
        provider_refund_id = p_provider_refund_id,
        processed_at = CASE
            WHEN v_target_status IN ('completed', 'failed') THEN
                COALESCE(processed_at, transaction_timestamp())
            ELSE processed_at
        END
    WHERE id = v_refund.id;

    IF v_target_status = 'completed' THEN
        INSERT INTO public.payment_transactions (
            payment_order_id,
            order_id,
            provider,
            provider_order_id,
            provider_payment_id,
            transaction_type,
            amount,
            currency,
            status,
            provider_reference,
            provider_payload,
            verified_at,
            processed_at
        )
        VALUES (
            v_payment.id,
            v_payment.order_id,
            v_payment.provider,
            v_payment.provider_order_id,
            v_payment.provider_payment_id,
            'refund',
            v_refund.amount,
            v_payment.currency,
            'refunded',
            p_provider_refund_id,
            COALESCE(p_provider_payload, '{}'::jsonb)
                || jsonb_build_object('status', p_provider_status),
            transaction_timestamp(),
            transaction_timestamp()
        )
        ON CONFLICT (
            payment_order_id,
            transaction_type,
            provider_reference
        ) WHERE payment_order_id IS NOT NULL
              AND transaction_type IS NOT NULL
              AND provider_reference IS NOT NULL
        DO NOTHING;

        SELECT COALESCE(sum(refund.amount), 0)
        INTO v_refunded
        FROM public.refund_requests AS refund
        WHERE refund.payment_order_id = v_payment.id
          AND refund.status = 'completed';

        UPDATE public.payment_orders
        SET
            status = CASE
                WHEN v_refunded >= amount THEN 'refunded'
                ELSE 'partially_refunded'
            END,
            updated_at = transaction_timestamp()
        WHERE id = v_payment.id;

        INSERT INTO public.financial_audit_logs (
            actor_profile_id,
            action,
            entity_type,
            entity_id,
            amount,
            metadata
        )
        SELECT
            v_refund.approved_by,
            'refund_approved',
            'refund_request',
            v_refund.id,
            v_refund.amount,
            jsonb_build_object(
                'providerRefundId', p_provider_refund_id,
                'providerStatus', p_provider_status
            )
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.financial_audit_logs AS audit
            WHERE audit.action = 'refund_approved'
              AND audit.entity_type = 'refund_request'
              AND audit.entity_id = v_refund.id
        );
    END IF;

    RETURN jsonb_build_object(
        'refundId', v_refund.id,
        'paymentOrderId', v_payment.id,
        'providerRefundId', p_provider_refund_id,
        'status', v_target_status,
        'duplicate', v_duplicate
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_refund_provider_uncertain_atomic(
    p_refund_id uuid,
    p_provider_refund_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_provider_refund_id IS NOT NULL
       AND btrim(p_provider_refund_id) = '' THEN
        RAISE EXCEPTION 'Provider refund identity cannot be blank'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.refund_requests
    SET
        status = 'processing',
        provider_refund_id = COALESCE(
            provider_refund_id,
            p_provider_refund_id
        )
    WHERE id = p_refund_id
      AND status IN ('approved', 'processing')
      AND (
          provider_refund_id IS NULL
          OR p_provider_refund_id IS NULL
          OR provider_refund_id = p_provider_refund_id
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund is not awaiting its provider result'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_captured_payment_atomic(uuid, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_failed_payment_atomic(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_payment_webhook_event_atomic(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_payment_webhook_event_atomic(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_refund_approval_atomic(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_provider_refund_atomic(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_refund_provider_uncertain_atomic(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_captured_payment_atomic(uuid, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_failed_payment_atomic(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_payment_webhook_event_atomic(text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_payment_webhook_event_atomic(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_refund_approval_atomic(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_provider_refund_atomic(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_refund_provider_uncertain_atomic(uuid, text) TO service_role;
