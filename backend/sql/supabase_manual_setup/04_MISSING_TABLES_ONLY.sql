-- =============================================================================
-- 04 — Create ONLY the missing tables (from your MISSING checklist)
-- Safe to re-run: uses IF NOT EXISTS where possible.
-- Run this entire file once in Supabase SQL Editor.
-- =============================================================================

-- Needed by several audit triggers
CREATE OR REPLACE FUNCTION public.reject_admin_staff_audit_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Admin staff audit is immutable' USING ERRCODE = '42501';
END;
$$;

-- ---------------------------------------------------------------------------
-- checkout_pricing_policies  (REQUIRED to place orders)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkout_pricing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_delivery_fee numeric(12,2) NOT NULL CHECK (pickup_delivery_fee >= 0),
  free_delivery_threshold numeric(12,2) NOT NULL CHECK (free_delivery_threshold >= 0),
  gst_rate_percent numeric(5,2) NOT NULL CHECK (gst_rate_percent >= 0 AND gst_rate_percent <= 100),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'checkout_pricing_policies'
      AND column_name = 'minimum_order_amount'
  ) THEN
    ALTER TABLE public.checkout_pricing_policies
      ADD COLUMN minimum_order_amount numeric(12,2) NOT NULL DEFAULT 199
      CHECK (minimum_order_amount >= 0);
  END IF;
END $$;

ALTER TABLE public.checkout_pricing_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkout_pricing_policies FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.checkout_pricing_policies TO service_role;

INSERT INTO public.checkout_pricing_policies (
  pickup_delivery_fee, free_delivery_threshold, gst_rate_percent, minimum_order_amount
)
SELECT 40, 499, 18, 199
WHERE NOT EXISTS (SELECT 1 FROM public.checkout_pricing_policies);

-- ---------------------------------------------------------------------------
-- driver_trip_locations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_trip_locations (
  assignment_id uuid PRIMARY KEY REFERENCES public.driver_assignments(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  latitude numeric(10,7) NOT NULL,
  longitude numeric(10,7) NOT NULL,
  accuracy_m numeric(10,2),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_trip_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_trip_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.driver_trip_locations TO service_role;

-- ---------------------------------------------------------------------------
-- package_service_limits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.package_service_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id),
  usage_limit integer NOT NULL CHECK (usage_limit >= 0),
  UNIQUE (package_id, service_id)
);

-- ---------------------------------------------------------------------------
-- facility intake / QC / packing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_intake_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  inspection_id uuid NOT NULL REFERENCES public.garment_inspections(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('missing', 'extra', 'damaged', 'weight_mismatch')),
  expected_quantity integer NOT NULL,
  counted_quantity integer NOT NULL,
  expected_weight_kg numeric(10,2),
  measured_weight_kg numeric(10,2),
  notes text NOT NULL CHECK (length(trim(notes)) > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES public.profiles(id),
  resolved_at timestamptz,
  resolution_notes text,
  CONSTRAINT discrepancy_resolution_complete CHECK (
    (status = 'open' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_notes IS NULL)
    OR (
      status = 'resolved'
      AND resolved_by IS NOT NULL
      AND resolved_at IS NOT NULL
      AND length(trim(coalesce(resolution_notes, ''))) > 0
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_facility_intake_discrepancies_open
  ON public.facility_intake_discrepancies(order_id, status);
ALTER TABLE public.facility_intake_discrepancies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_intake_discrepancies FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.facility_intake_policy_orders (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  activated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.facility_intake_policy_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_intake_policy_orders FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.facility_qc_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.facility_order_operations(id) ON DELETE CASCADE,
  cycle_number integer NOT NULL CHECK (cycle_number BETWEEN 0 AND 2),
  approved boolean NOT NULL,
  rewash_required boolean NOT NULL,
  defect_code text,
  reason text,
  affected_item_ids uuid[] NOT NULL DEFAULT '{}',
  decided_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT qc_failure_requires_reason CHECK (
    approved OR (defect_code IS NOT NULL AND length(btrim(reason)) >= 5)
  ),
  CONSTRAINT qc_rewash_matches_verdict CHECK (rewash_required = NOT approved)
);
CREATE INDEX IF NOT EXISTS idx_facility_qc_decisions_order
  ON public.facility_qc_decisions(order_id, created_at);
ALTER TABLE public.facility_qc_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_qc_decisions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.facility_packing_policy_orders (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  activated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
ALTER TABLE public.facility_packing_policy_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_packing_policy_orders FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.facility_packings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  packaging_operation_id uuid NOT NULL REFERENCES public.facility_order_operations(id),
  cycle_number integer NOT NULL CHECK (cycle_number BETWEEN 0 AND 2),
  parcel_id text NOT NULL UNIQUE CHECK (parcel_id ~ '^[A-Z0-9-]{6,40}$'),
  packed_by uuid NOT NULL REFERENCES public.profiles(id),
  packed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  notes text,
  UNIQUE (order_id, cycle_number)
);
CREATE TABLE IF NOT EXISTS public.facility_packing_items (
  packing_id uuid NOT NULL REFERENCES public.facility_packings(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id),
  verified_quantity integer NOT NULL CHECK (verified_quantity >= 0),
  packed_quantity integer NOT NULL CHECK (packed_quantity >= 0),
  PRIMARY KEY (packing_id, order_item_id),
  CHECK (packed_quantity = verified_quantity)
);
ALTER TABLE public.facility_packings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_packing_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_packings, public.facility_packing_items FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin audit tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_staff_action_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  target_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (
    action IN ('provision', 'activate', 'deactivate', 'revoke_access', 'reassign_facility')
  ),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_staff_action_audit_target_time
  ON public.admin_staff_action_audit(target_profile_id, created_at DESC);
ALTER TABLE public.admin_staff_action_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_staff_action_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_staff_action_audit TO service_role;
DROP TRIGGER IF EXISTS admin_staff_audit_immutable ON public.admin_staff_action_audit;
CREATE TRIGGER admin_staff_audit_immutable
BEFORE UPDATE OR DELETE ON public.admin_staff_action_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

CREATE TABLE IF NOT EXISTS public.admin_assignment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  previous_assignment_id uuid REFERENCES public.driver_assignments(id),
  new_assignment_id uuid NOT NULL REFERENCES public.driver_assignments(id),
  action text NOT NULL CHECK (action IN ('assign', 'reassign')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_assignment_audit_order_time
  ON public.admin_assignment_audit(order_id, created_at DESC);
ALTER TABLE public.admin_assignment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_assignment_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_assignment_audit TO service_role;
DROP TRIGGER IF EXISTS admin_assignment_audit_immutable ON public.admin_assignment_audit;
CREATE TRIGGER admin_assignment_audit_immutable
BEFORE UPDATE OR DELETE ON public.admin_assignment_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

CREATE TABLE IF NOT EXISTS public.admin_catalogue_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  entity_id uuid NOT NULL,
  before_value jsonb,
  after_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_catalogue_audit_entity_time
  ON public.admin_catalogue_audit(entity_id, created_at DESC);
ALTER TABLE public.admin_catalogue_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_catalogue_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_catalogue_audit TO service_role;
DROP TRIGGER IF EXISTS admin_catalogue_audit_immutable ON public.admin_catalogue_audit;
CREATE TRIGGER admin_catalogue_audit_immutable
BEFORE UPDATE OR DELETE ON public.admin_catalogue_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

CREATE TABLE IF NOT EXISTS public.admin_issue_decision_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  claim_id uuid REFERENCES public.customer_order_claims(id),
  refund_id uuid REFERENCES public.refund_requests(id),
  action text NOT NULL CHECK (
    action IN (
      'claim_review', 'claim_approve', 'claim_reject', 'claim_resolve',
      'refund_request', 'refund_approve', 'refund_reject'
    )
  ),
  notes text NOT NULL,
  before_status text,
  after_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_issue_decision_audit_order_time
  ON public.admin_issue_decision_audit(order_id, created_at DESC);
ALTER TABLE public.admin_issue_decision_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_issue_decision_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_issue_decision_audit TO service_role;
DROP TRIGGER IF EXISTS admin_issue_decision_audit_immutable ON public.admin_issue_decision_audit;
CREATE TRIGGER admin_issue_decision_audit_immutable
BEFORE UPDATE OR DELETE ON public.admin_issue_decision_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

CREATE TABLE IF NOT EXISTS public.admin_growth_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  referral_enabled boolean NOT NULL DEFAULT true,
  referral_reward_points integer NOT NULL DEFAULT 0 CHECK (referral_reward_points BETWEEN 0 AND 1000000),
  loyalty_earn_points_per_rupee numeric(10,4) NOT NULL DEFAULT 0.01
    CHECK (loyalty_earn_points_per_rupee BETWEEN 0 AND 100),
  loyalty_points_per_rupee integer NOT NULL DEFAULT 10
    CHECK (loyalty_points_per_rupee BETWEEN 1 AND 1000000),
  loyalty_minimum_redemption_rupees numeric(12,2) NOT NULL DEFAULT 100
    CHECK (loyalty_minimum_redemption_rupees BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.admin_growth_settings (id)
SELECT true
WHERE NOT EXISTS (SELECT 1 FROM public.admin_growth_settings WHERE id = true);
ALTER TABLE public.admin_growth_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_growth_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.admin_growth_settings TO service_role;

CREATE TABLE IF NOT EXISTS public.offer_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  coupon_code text NOT NULL,
  discount_amount numeric(12,2) NOT NULL CHECK (discount_amount > 0),
  offer_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz
);
CREATE INDEX IF NOT EXISTS offer_redemptions_active
  ON public.offer_redemptions(offer_id)
  WHERE reversed_at IS NULL;
ALTER TABLE public.offer_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offer_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.offer_redemptions TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_growth_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_growth_audit_time
  ON public.admin_growth_audit(created_at DESC);
ALTER TABLE public.admin_growth_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_growth_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_growth_audit TO service_role;
DROP TRIGGER IF EXISTS admin_growth_audit_immutable ON public.admin_growth_audit;
CREATE TRIGGER admin_growth_audit_immutable
BEFORE UPDATE OR DELETE ON public.admin_growth_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_staff_audit_change();

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
SELECT expected.table_name,
       CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM (
  VALUES
    ('checkout_pricing_policies'),
    ('driver_trip_locations'),
    ('package_service_limits'),
    ('facility_intake_discrepancies'),
    ('facility_intake_policy_orders'),
    ('facility_qc_decisions'),
    ('facility_packings'),
    ('facility_packing_items'),
    ('facility_packing_policy_orders'),
    ('admin_assignment_audit'),
    ('admin_catalogue_audit'),
    ('admin_staff_action_audit'),
    ('admin_issue_decision_audit'),
    ('admin_growth_settings'),
    ('admin_growth_audit'),
    ('offer_redemptions')
) AS expected(table_name)
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_name = expected.table_name
ORDER BY status DESC, expected.table_name;
