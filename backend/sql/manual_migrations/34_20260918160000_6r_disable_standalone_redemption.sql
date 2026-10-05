-- Preserve the old function for compatibility, but prevent service-role use.
-- Customer redemption is only available in atomic checkout order creation.
REVOKE EXECUTE ON FUNCTION public.redeem_customer_loyalty_points(uuid, integer, text)
FROM service_role;
