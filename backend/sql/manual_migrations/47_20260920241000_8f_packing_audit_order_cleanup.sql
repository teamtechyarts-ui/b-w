-- Keep packing audit tied to its operation while permitting local fictional
-- order cleanup and the existing order-retention cascade.
ALTER TABLE public.facility_packings
  DROP CONSTRAINT facility_packings_packaging_operation_id_fkey;
ALTER TABLE public.facility_packings
  ADD CONSTRAINT facility_packings_packaging_operation_id_fkey
  FOREIGN KEY (packaging_operation_id)
  REFERENCES public.facility_order_operations(id) ON DELETE CASCADE;
