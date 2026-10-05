BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS terms_version text;

UPDATE public.orders
SET terms_version = 'legacy-pre-2026.09.17'
WHERE terms_accepted = true
  AND terms_version IS NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_terms_acceptance_version_consistency;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_terms_acceptance_version_consistency
  CHECK (
    terms_accepted = false
    OR (
      terms_accepted = true
      AND terms_accepted_at IS NOT NULL
      AND terms_version IS NOT NULL
      AND length(btrim(terms_version)) > 0
    )
  );

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_terms_version_not_blank;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_terms_version_not_blank
  CHECK (
    terms_version IS NULL
    OR length(btrim(terms_version)) > 0
  );

COMMENT ON COLUMN public.orders.terms_version IS
'Version identifier of the customer Terms & Conditions accepted for this order. Historical accepted orders created before version tracking use legacy-pre-2026.09.17.';

COMMIT;
