BEGIN;

-- =========================================================
-- BRIGHT & WHITE - REAL B2C CUSTOMER CATALOGUE
-- =========================================================

-- Hide the old runtime integration fixture from customers.
-- Keep the row for historical/test-reference safety.
UPDATE public.services
SET is_active = false
WHERE name = 'Runtime Garment Care';


-- =========================================================
-- 1. CUSTOMER-FACING CATEGORIES
-- =========================================================

INSERT INTO public.service_categories (
  name,
  description,
  is_active
)
VALUES
  ('Wash & Fold', 'Everyday laundry charged by weight', true),
  ('Wash & Steam Iron', 'Washing with professional steam ironing', true),
  ('Premium Laundry', 'Premium garment washing and finishing', true),
  ('Wash & Iron', 'Item-wise washing and ironing', true),
  ('Steam Ironing', 'Professional steam ironing', true),
  ('Dry Cleaning', 'Professional dry-cleaning services', true),
  ('Household & Linen Care', 'Bedding, linen, curtains and household laundry', true),
  ('Shoe Cleaning', 'Professional shoe cleaning and restoration', true),
  ('Add-On Services', 'Optional garment and laundry care add-ons', true)
ON CONFLICT (name)
DO UPDATE SET
  description = EXCLUDED.description,
  is_active = true;


-- =========================================================
-- 2. TEMPORARY CATALOGUE SOURCE
-- =========================================================

CREATE TEMP TABLE bw_catalog (
  category_name text NOT NULL,
  service_name text NOT NULL,
  description text,
  pricing_unit text NOT NULL,
  price numeric(12,2)
) ON COMMIT DROP;


INSERT INTO bw_catalog (
  category_name,
  service_name,
  description,
  pricing_unit,
  price
)
VALUES

-- =========================================================
-- WASH & FOLD
-- =========================================================

('Wash & Fold',
 'Wash & Fold',
 'Everyday garments',
 'kg',
 89.00),

-- =========================================================
-- WASH & STEAM IRON
-- =========================================================

('Wash & Steam Iron',
 'Wash & Steam Iron',
 'Most popular',
 'kg',
 119.00),

-- =========================================================
-- PREMIUM LAUNDRY
-- =========================================================

('Premium Laundry',
 'Premium Laundry',
 'Premium garment care',
 'kg',
 149.00),

-- =========================================================
-- WASH & IRON - MEN
-- =========================================================

('Wash & Iron','Men - Shirt',NULL,'piece',35.00),
('Wash & Iron','Men - T-Shirt',NULL,'piece',30.00),
('Wash & Iron','Men - Polo T-Shirt',NULL,'piece',35.00),
('Wash & Iron','Men - Trouser',NULL,'piece',40.00),
('Wash & Iron','Men - Jeans',NULL,'piece',45.00),
('Wash & Iron','Men - Chinos',NULL,'piece',40.00),
('Wash & Iron','Men - Shorts',NULL,'piece',30.00),
('Wash & Iron','Men - Track Pant',NULL,'piece',35.00),
('Wash & Iron','Men - Joggers',NULL,'piece',35.00),
('Wash & Iron','Men - Kurta',NULL,'piece',50.00),
('Wash & Iron','Men - Pyjama',NULL,'piece',30.00),
('Wash & Iron','Men - Kurta + Pyjama Set',NULL,'set',75.00),
('Wash & Iron','Men - Dhoti',NULL,'piece',50.00),
('Wash & Iron','Men - Silk Dhoti',NULL,'piece',75.00),
('Wash & Iron','Men - Hoodie',NULL,'piece',70.00),
('Wash & Iron','Men - Sweater',NULL,'piece',80.00),

-- =========================================================
-- WASH & IRON - WOMEN
-- =========================================================

('Wash & Iron','Women - Top',NULL,'piece',35.00),
('Wash & Iron','Women - T-Shirt',NULL,'piece',30.00),
('Wash & Iron','Women - Shirt',NULL,'piece',35.00),
('Wash & Iron','Women - Kurti',NULL,'piece',50.00),
('Wash & Iron','Women - Long Kurti',NULL,'piece',60.00),
('Wash & Iron','Women - Leggings',NULL,'piece',30.00),
('Wash & Iron','Women - Palazzo',NULL,'piece',40.00),
('Wash & Iron','Women - Salwar',NULL,'piece',40.00),
('Wash & Iron','Women - Dupatta',NULL,'piece',30.00),
('Wash & Iron','Women - Blouse',NULL,'piece',40.00),
('Wash & Iron','Women - Skirt',NULL,'piece',50.00),
('Wash & Iron','Women - Short Dress',NULL,'piece',80.00),
('Wash & Iron','Women - Long Dress',NULL,'piece',120.00),
('Wash & Iron','Women - Gown',NULL,'piece',180.00),
('Wash & Iron','Women - Cotton Saree',NULL,'piece',100.00),
('Wash & Iron','Women - Silk Saree',NULL,'piece',150.00),

-- =========================================================
-- STEAM IRONING
-- =========================================================

('Steam Ironing','Men - Shirt',NULL,'piece',15.00),
('Steam Ironing','Men - T-Shirt',NULL,'piece',15.00),
('Steam Ironing','Men - Trouser',NULL,'piece',20.00),
('Steam Ironing','Men - Jeans',NULL,'piece',20.00),
('Steam Ironing','Men - Kurta',NULL,'piece',25.00),
('Steam Ironing','Men - Pyjama',NULL,'piece',15.00),

('Steam Ironing','Women - Blouse',NULL,'piece',20.00),
('Steam Ironing','Women - Saree',NULL,'piece',50.00),
('Steam Ironing','Women - Heavy Saree',NULL,'piece',80.00),
('Steam Ironing','Women - Dress',NULL,'piece',40.00),
('Steam Ironing','Women - Long Dress',NULL,'piece',60.00),

('Steam Ironing','Premium - Blazer',NULL,'piece',60.00),
('Steam Ironing','Premium - Suit',NULL,'set',100.00),

('Steam Ironing','Household - Bedsheet',NULL,'piece',40.00),

-- =========================================================
-- DRY CLEANING - MEN
-- =========================================================

('Dry Cleaning','Men - Shirt',NULL,'piece',99.00),
('Dry Cleaning','Men - Premium / Party Shirt',NULL,'piece',129.00),
('Dry Cleaning','Men - T-Shirt',NULL,'piece',89.00),
('Dry Cleaning','Men - Trouser',NULL,'piece',110.00),
('Dry Cleaning','Men - Jeans',NULL,'piece',120.00),
('Dry Cleaning','Men - Chinos',NULL,'piece',110.00),
('Dry Cleaning','Men - Shorts',NULL,'piece',80.00),
('Dry Cleaning','Men - Kurta',NULL,'piece',130.00),
('Dry Cleaning','Men - Heavy Kurta',NULL,'piece',180.00),
('Dry Cleaning','Men - Pyjama',NULL,'piece',80.00),
('Dry Cleaning','Men - Kurta + Pyjama',NULL,'set',190.00),
('Dry Cleaning','Men - Waistcoat',NULL,'piece',150.00),
('Dry Cleaning','Men - Blazer',NULL,'piece',249.00),
('Dry Cleaning','Men - Coat',NULL,'piece',299.00),
('Dry Cleaning','Men - Jacket',NULL,'piece',249.00),
('Dry Cleaning','Men - Leather Jacket','Special care','piece',799.00),
('Dry Cleaning','Men - Sweater',NULL,'piece',149.00),
('Dry Cleaning','Men - Hoodie',NULL,'piece',149.00),
('Dry Cleaning','Men - 2-Piece Suit',NULL,'set',449.00),
('Dry Cleaning','Men - 3-Piece Suit',NULL,'set',549.00),
('Dry Cleaning','Men - Basic Sherwani',NULL,'piece',499.00),
('Dry Cleaning','Men - Heavy Sherwani',NULL,'piece',799.00),

-- =========================================================
-- DRY CLEANING - WOMEN
-- =========================================================

('Dry Cleaning','Women - Top',NULL,'piece',99.00),
('Dry Cleaning','Women - Kurti',NULL,'piece',129.00),
('Dry Cleaning','Women - Long Kurti',NULL,'piece',159.00),
('Dry Cleaning','Women - Palazzo',NULL,'piece',110.00),
('Dry Cleaning','Women - Salwar',NULL,'piece',110.00),
('Dry Cleaning','Women - Dupatta',NULL,'piece',99.00),
('Dry Cleaning','Women - Basic Blouse',NULL,'piece',99.00),
('Dry Cleaning','Women - Heavy Work Blouse',NULL,'piece',199.00),
('Dry Cleaning','Women - Cotton Saree',NULL,'piece',199.00),
('Dry Cleaning','Women - Silk Saree',NULL,'piece',299.00),
('Dry Cleaning','Women - Designer Saree',NULL,'piece',399.00),
('Dry Cleaning','Women - Heavy Work Saree',NULL,'piece',599.00),
('Dry Cleaning','Women - Short Dress',NULL,'piece',199.00),
('Dry Cleaning','Women - Long Dress',NULL,'piece',299.00),
('Dry Cleaning','Women - Gown',NULL,'piece',399.00),
('Dry Cleaning','Women - Heavy Work Gown',NULL,'piece',699.00),
('Dry Cleaning','Women - Skirt',NULL,'piece',149.00),
('Dry Cleaning','Women - Basic Lehenga',NULL,'piece',499.00),
('Dry Cleaning','Women - Heavy Lehenga',NULL,'piece',999.00),
('Dry Cleaning',
 'Women - Lehenga + Blouse + Dupatta',
 'Starting price',
 'set',
 1199.00),
('Dry Cleaning','Women - Anarkali',NULL,'piece',349.00),
('Dry Cleaning','Women - Heavy Anarkali',NULL,'piece',599.00),

-- =========================================================
-- HOUSEHOLD & LINEN CARE
-- =========================================================

('Household & Linen Care',
 'Single Bedsheet - Wash',
 NULL,
 'piece',
 40.00),

('Household & Linen Care',
 'Single Bedsheet - Wash & Iron',
 NULL,
 'piece',
 70.00),

('Household & Linen Care',
 'Double Bedsheet - Wash',
 NULL,
 'piece',
 60.00),

('Household & Linen Care',
 'Double Bedsheet - Wash & Iron',
 NULL,
 'piece',
 100.00),

('Household & Linen Care',
 'Pillow Cover - Wash',
 NULL,
 'piece',
 15.00),

('Household & Linen Care',
 'Pillow Cover - Wash & Iron',
 NULL,
 'piece',
 25.00),

('Household & Linen Care',
 'Towel - Wash',
 NULL,
 'piece',
 25.00),

('Household & Linen Care',
 'Towel - Wash & Iron',
 NULL,
 'piece',
 40.00),

('Household & Linen Care',
 'Pillow Cleaning',
 NULL,
 'piece',
 100.00),

('Household & Linen Care',
 'Single Blanket',
 NULL,
 'piece',
 250.00),

('Household & Linen Care',
 'Double Blanket',
 NULL,
 'piece',
 350.00),

('Household & Linen Care',
 'Single Quilt',
 NULL,
 'piece',
 350.00),

('Household & Linen Care',
 'Double Quilt',
 NULL,
 'piece',
 450.00),

('Household & Linen Care',
 'Duvet',
 NULL,
 'piece',
 400.00),

('Household & Linen Care',
 'Small Curtain',
 NULL,
 'piece',
 50.00),

('Household & Linen Care',
 'Large Curtain',
 NULL,
 'piece',
 80.00),

('Household & Linen Care',
 'Small Carpet',
 NULL,
 'piece',
 500.00),

-- Quote-based item intentionally has NO service_prices record.
('Household & Linen Care',
 'Large Carpet',
 'Price after inspection',
 'quote',
 NULL),

-- =========================================================
-- SHOE CLEANING
-- =========================================================

('Shoe Cleaning','Basic Shoe Cleaning',NULL,'pair',199.00),
('Shoe Cleaning','Sports Shoes',NULL,'pair',249.00),
('Shoe Cleaning','Sneakers',NULL,'pair',299.00),
('Shoe Cleaning','Premium Sneakers',NULL,'pair',399.00),
('Shoe Cleaning','Leather Shoes',NULL,'pair',399.00),
('Shoe Cleaning','Suede Shoes',NULL,'pair',499.00),
('Shoe Cleaning','Boots',NULL,'pair',599.00),
('Shoe Cleaning','Shoe Whitening',NULL,'pair',249.00),
('Shoe Cleaning','Deodorization','Add-on','pair',99.00),
('Shoe Cleaning',
 'Premium Restoration',
 'Starting price',
 'pair',
 699.00),

-- =========================================================
-- ADD-ON SERVICES
-- =========================================================

('Add-On Services','Fabric Softener',NULL,'kg',10.00),
('Add-On Services','Sanitization',NULL,'kg',15.00),
('Add-On Services','Antibacterial Wash',NULL,'kg',15.00),
('Add-On Services','Whitening Treatment',NULL,'item',20.00),
('Add-On Services','Basic Stain Removal',NULL,'item',30.00),
('Add-On Services',
 'Heavy Stain Removal',
 'Starting price',
 'item',
 75.00),
('Add-On Services','Starching',NULL,'item',20.00),
('Add-On Services','Premium Packaging',NULL,'order',20.00),
('Add-On Services','Individual Garment Packing',NULL,'item',10.00),
('Add-On Services','Hanger Packing',NULL,'item',15.00);


-- =========================================================
-- 3. UPDATE SERVICES THAT ALREADY EXIST
-- =========================================================

UPDATE public.services s
SET
  description = c.description,
  pricing_unit = c.pricing_unit,
  is_active = true
FROM bw_catalog c
JOIN public.service_categories sc
  ON sc.name = c.category_name
WHERE
  s.category_id = sc.id
  AND s.name = c.service_name;


-- =========================================================
-- 4. INSERT SERVICES THAT DO NOT EXIST
-- =========================================================

INSERT INTO public.services (
  category_id,
  name,
  description,
  pricing_unit,
  is_active
)
SELECT
  sc.id,
  c.service_name,
  c.description,
  c.pricing_unit,
  true
FROM bw_catalog c
JOIN public.service_categories sc
  ON sc.name = c.category_name
WHERE NOT EXISTS (
  SELECT 1
  FROM public.services s
  WHERE
    s.category_id = sc.id
    AND s.name = c.service_name
);


-- =========================================================
-- 5. CLOSE EXISTING GLOBAL PRICES FOR THIS CATALOGUE
-- =========================================================

UPDATE public.service_prices sp
SET effective_to = CURRENT_TIMESTAMP
FROM
  public.services s,
  public.service_categories sc,
  bw_catalog c
WHERE
  sp.service_id = s.id
  AND s.category_id = sc.id
  AND sc.name = c.category_name
  AND s.name = c.service_name
  AND sp.facility_id IS NULL
  AND sp.effective_to IS NULL;


-- =========================================================
-- 6. INSERT CURRENT GLOBAL CUSTOMER PRICES
-- =========================================================

INSERT INTO public.service_prices (
  service_id,
  facility_id,
  price,
  effective_from,
  effective_to
)
SELECT
  s.id,
  NULL,
  c.price,
  CURRENT_TIMESTAMP,
  NULL
FROM bw_catalog c
JOIN public.service_categories sc
  ON sc.name = c.category_name
JOIN public.services s
  ON s.category_id = sc.id
 AND s.name = c.service_name
WHERE c.price IS NOT NULL;


COMMIT;