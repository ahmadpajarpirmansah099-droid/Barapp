-- Restore authenticated execution for SECURITY DEFINER helpers
-- that are called directly by RLS policies.
-- Keep anonymous and PUBLIC execution revoked.

REVOKE ALL PRIVILEGES
ON FUNCTION public.can_access_outlet(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.can_access_outlet(uuid)
TO authenticated;

REVOKE ALL PRIVILEGES
ON FUNCTION public.barapp_can_manage_stock_in(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.barapp_can_manage_stock_in(uuid)
TO authenticated;
