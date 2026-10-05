-- A packing item belongs to its original order item and should be removed
-- when a fictional Development order is deleted through the normal cascade.
ALTER TABLE public.facility_packing_items
  DROP CONSTRAINT facility_packing_items_order_item_id_fkey;
ALTER TABLE public.facility_packing_items
  ADD CONSTRAINT facility_packing_items_order_item_id_fkey
  FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;
