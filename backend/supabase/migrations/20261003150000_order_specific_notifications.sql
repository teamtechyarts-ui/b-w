-- 20261003150000_order_specific_notifications.sql
-- Authoritative order-specific notifications and zero-confusion operational alerts

-- 1. Authoritative Customer Order Lifecycle Notifications Trigger Function
CREATE OR REPLACE FUNCTION public.create_customer_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id uuid;
  v_order_number text;
  v_title text;
  v_body text;
  v_action text := 'view_order';
  v_notification_type text;
BEGIN
  -- If updating and status hasn't changed, skip
  IF TG_OP = 'UPDATE' AND NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
    RETURN NEW;
  END IF;

  SELECT c.profile_id INTO v_profile_id
  FROM public.customers c
  WHERE c.id = NEW.customer_id;

  IF v_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_order_number := COALESCE(NEW.order_number, NEW.id::text);
  v_notification_type := concat('order.', NEW.current_status::text);

  CASE NEW.current_status
    WHEN 'confirmed' THEN
      v_title := 'Order confirmed';
      v_body := format('Order %s has been placed and confirmed.', v_order_number);
      v_action := 'view_order';
    WHEN 'pickup_accepted' THEN
      v_title := 'Pickup driver assigned';
      v_body := format('A driver has accepted pickup for Order %s.', v_order_number);
      v_action := 'view_order';
    WHEN 'en_route_pickup' THEN
      v_title := 'Driver en route for pickup';
      v_body := format('Your driver is on the way to pick up Order %s.', v_order_number);
      v_action := 'view_order';
    WHEN 'pickup_otp_pending' THEN
      v_title := 'Driver has arrived';
      v_body := format('Driver arrived for Order %s. Please provide the pickup OTP.', v_order_number);
      v_action := 'provide_pickup_otp';
    WHEN 'picked_up' THEN
      v_title := 'Order picked up';
      v_body := format('Order %s has been picked up by the driver.', v_order_number);
      v_action := 'view_order';
    WHEN 'received_at_facility' THEN
      v_title := 'Laundry received at facility';
      v_body := format('Order %s has arrived and was received at the facility.', v_order_number);
      v_action := 'view_order';
    WHEN 'verification' THEN
      v_title := 'Intake verification';
      v_body := format('Order %s is undergoing garment intake verification.', v_order_number);
      v_action := 'view_order';
    WHEN 'processing' THEN
      v_title := 'Processing started';
      v_body := format('Order %s is currently being washed and processed.', v_order_number);
      v_action := 'view_order';
    WHEN 'quality_check' THEN
      v_title := 'Quality check in progress';
      v_body := format('Order %s is undergoing quality inspection.', v_order_number);
      v_action := 'view_order';
    WHEN 'ready_for_delivery' THEN
      v_title := 'Ready for delivery';
      v_body := format('Order %s is clean, packed, and ready for delivery.', v_order_number);
      v_action := 'view_order';
    WHEN 'delivery_accepted' THEN
      v_title := 'Delivery driver assigned';
      v_body := format('A driver has accepted delivery for Order %s.', v_order_number);
      v_action := 'view_order';
    WHEN 'en_route_delivery' THEN
      v_title := 'Driver en route for delivery';
      v_body := format('Your driver is on the way to deliver Order %s.', v_order_number);
      v_action := 'view_order';
    WHEN 'delivery_otp_pending' THEN
      v_title := 'Delivery driver has arrived';
      v_body := format('Driver arrived with Order %s. Please provide the delivery OTP.', v_order_number);
      v_action := 'provide_delivery_otp';
    WHEN 'delivered' THEN
      v_title := 'Order delivered';
      v_body := format('Order %s has been successfully delivered. Thank you!', v_order_number);
      v_action := 'view_order';
    WHEN 'claim_period_active' THEN
      v_title := 'Claim period active';
      v_body := format('Review period for Order %s is active.', v_order_number);
      v_action := 'view_order';
    WHEN 'cancelled' THEN
      v_title := 'Order cancelled';
      v_body := format('Order %s has been cancelled.', v_order_number);
      v_action := 'view_order';
    ELSE
      v_title := NULL;
  END CASE;

  IF v_title IS NULL THEN
    RETURN NEW;
  END IF;

  -- Duplicate protection: Prevent multiple identical notifications within 60 seconds
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE profile_id = v_profile_id
      AND order_id = NEW.id
      AND (notification_type = v_notification_type OR event_type = v_notification_type)
      AND created_at > (now() - interval '60 seconds')
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    profile_id,
    order_id,
    channel,
    priority,
    event_type,
    notification_type,
    title,
    message,
    body,
    data,
    status
  )
  VALUES (
    v_profile_id,
    NEW.id,
    'in_app'::public.notification_channel,
    'normal'::public.notification_priority,
    v_notification_type,
    v_notification_type,
    v_title,
    v_body,
    v_body,
    jsonb_build_object(
      'orderId', NEW.id::text,
      'orderNumber', v_order_number,
      'status', NEW.current_status::text,
      'action', v_action
    ),
    'queued'::public.notification_status
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_order_status_notification ON public.orders;
CREATE TRIGGER trg_customer_order_status_notification
AFTER INSERT OR UPDATE OF current_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.create_customer_order_status_notification();


-- 2. Authoritative Driver Assignment Notifications Trigger Function
CREATE OR REPLACE FUNCTION public.notify_driver_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver record;
  v_order record;
  v_title text;
  v_body text;
  v_notification_type text;
  v_order_number text;
BEGIN
  IF NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile_id INTO v_driver
  FROM public.drivers
  WHERE id = NEW.driver_id;

  IF v_driver.profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, order_number INTO v_order
  FROM public.orders
  WHERE id = NEW.order_id;

  v_order_number := COALESCE(v_order.order_number, NEW.order_id::text);
  v_notification_type := concat('driver.', NEW.assignment_type, '_assigned');

  IF NEW.assignment_type = 'pickup' THEN
    v_title := 'New pickup task available';
    v_body := format('Order %s is ready for pickup. Tap to review details.', v_order_number);
  ELSE
    v_title := 'New delivery task available';
    v_body := format('Order %s is ready for delivery. Tap to review details.', v_order_number);
  END IF;

  -- Duplicate protection
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE profile_id = v_driver.profile_id
      AND order_id = NEW.order_id
      AND (notification_type = v_notification_type OR event_type = v_notification_type)
      AND created_at > (now() - interval '60 seconds')
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    profile_id,
    order_id,
    channel,
    priority,
    event_type,
    notification_type,
    title,
    message,
    body,
    data,
    status
  )
  VALUES (
    v_driver.profile_id,
    NEW.order_id,
    'in_app'::public.notification_channel,
    'normal'::public.notification_priority,
    v_notification_type,
    v_notification_type,
    v_title,
    v_body,
    v_body,
    jsonb_build_object(
      'orderId', NEW.order_id::text,
      'orderNumber', v_order_number,
      'assignmentId', NEW.id::text,
      'assignmentType', NEW.assignment_type::text,
      'action', 'driver_job'
    ),
    'queued'::public.notification_status
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_driver_on_assignment ON public.driver_assignments;
CREATE TRIGGER trg_notify_driver_on_assignment
AFTER INSERT ON public.driver_assignments
FOR EACH ROW EXECUTE FUNCTION public.notify_driver_on_assignment();


-- 3. Authoritative Driver Operational Arrival Trigger Function
CREATE OR REPLACE FUNCTION public.notify_driver_operational_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver record;
  v_order record;
  v_title text;
  v_body text;
  v_notification_type text;
  v_order_number text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('arrived'::public.assignment_status, 'accepted'::public.assignment_status) THEN
    RETURN NEW;
  END IF;

  SELECT profile_id INTO v_driver
  FROM public.drivers
  WHERE id = NEW.driver_id;

  IF v_driver.profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, order_number INTO v_order
  FROM public.orders
  WHERE id = NEW.order_id;

  v_order_number := COALESCE(v_order.order_number, NEW.order_id::text);

  IF NEW.status = 'arrived' THEN
    IF NEW.assignment_type = 'pickup' THEN
      v_title := 'Pickup OTP required';
      v_body := format('Ask customer for pickup OTP for Order %s.', v_order_number);
      v_notification_type := 'driver.pickup_otp_required';
    ELSE
      v_title := 'Delivery OTP required';
      v_body := format('Ask customer for delivery OTP for Order %s.', v_order_number);
      v_notification_type := 'driver.delivery_otp_required';
    END IF;
  ELSIF NEW.status = 'accepted' THEN
    IF NEW.assignment_type = 'pickup' THEN
      v_title := 'Pickup task accepted';
      v_body := format('You accepted pickup for Order %s.', v_order_number);
      v_notification_type := 'driver.pickup_accepted';
    ELSE
      v_title := 'Delivery task accepted';
      v_body := format('You accepted delivery for Order %s. Collect from facility when ready.', v_order_number);
      v_notification_type := 'driver.delivery_accepted';
    END IF;
  END IF;

  IF v_title IS NULL THEN
    RETURN NEW;
  END IF;

  -- Duplicate protection
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE profile_id = v_driver.profile_id
      AND order_id = NEW.order_id
      AND (notification_type = v_notification_type OR event_type = v_notification_type)
      AND created_at > (now() - interval '60 seconds')
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    profile_id,
    order_id,
    channel,
    priority,
    event_type,
    notification_type,
    title,
    message,
    body,
    data,
    status
  )
  VALUES (
    v_driver.profile_id,
    NEW.order_id,
    'in_app'::public.notification_channel,
    'normal'::public.notification_priority,
    v_notification_type,
    v_notification_type,
    v_title,
    v_body,
    v_body,
    jsonb_build_object(
      'orderId', NEW.order_id::text,
      'orderNumber', v_order_number,
      'assignmentId', NEW.id::text,
      'assignmentType', NEW.assignment_type::text,
      'action', 'driver_job'
    ),
    'queued'::public.notification_status
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_driver_operational_events ON public.driver_assignments;
CREATE TRIGGER trg_notify_driver_operational_events
AFTER UPDATE OF status ON public.driver_assignments
FOR EACH ROW EXECUTE FUNCTION public.notify_driver_operational_events();


-- 4. Authoritative Facility Employee Arrival / Handover Notifications
CREATE OR REPLACE FUNCTION public.notify_facility_operational_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff record;
  v_order record;
  v_title text;
  v_body text;
  v_notification_type text;
  v_order_number text;
  v_action text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Driver arrives for delivery collection at facility
  IF NEW.status = 'arrived' AND NEW.assignment_type = 'delivery' THEN
    SELECT id, order_number, facility_id INTO v_order
    FROM public.orders
    WHERE id = NEW.order_id;

    IF v_order.facility_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_order_number := COALESCE(v_order.order_number, NEW.order_id::text);
    v_title := 'Delivery driver arrived';
    v_body := format('Driver has arrived to collect Order %s. Handover required.', v_order_number);
    v_notification_type := 'facility.delivery_driver_arrived';
    v_action := 'facility_handover';

    -- Notify all active staff assigned to this facility
    FOR v_staff IN
      SELECT p.id AS profile_id
      FROM public.facility_staff fs
      JOIN public.profiles p ON p.id = fs.profile_id
      WHERE fs.facility_id = v_order.facility_id
        AND fs.is_active = true
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE profile_id = v_staff.profile_id
          AND order_id = NEW.order_id
          AND (notification_type = v_notification_type OR event_type = v_notification_type)
          AND created_at > (now() - interval '60 seconds')
      ) THEN
        INSERT INTO public.notifications (
          profile_id,
          order_id,
          channel,
          priority,
          event_type,
          notification_type,
          title,
          message,
          body,
          data,
          status
        )
        VALUES (
          v_staff.profile_id,
          NEW.order_id,
          'in_app'::public.notification_channel,
          'normal'::public.notification_priority,
          v_notification_type,
          v_notification_type,
          v_title,
          v_body,
          v_body,
          jsonb_build_object(
            'orderId', NEW.order_id::text,
            'orderNumber', v_order_number,
            'facilityId', v_order.facility_id::text,
            'action', v_action
          ),
          'queued'::public.notification_status
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_facility_operational_events ON public.driver_assignments;
CREATE TRIGGER trg_notify_facility_operational_events
AFTER UPDATE OF status ON public.driver_assignments
FOR EACH ROW EXECUTE FUNCTION public.notify_facility_operational_events();
