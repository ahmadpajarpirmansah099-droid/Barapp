-- Restrict direct RPC access to internal authorization/validation helpers.
-- Application RPCs call these helpers under their own SECURITY DEFINER owner context.
REVOKE EXECUTE ON FUNCTION public.barapp_closing_assert_access() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.barapp_closing_module_snapshot(uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cogs_assert_division_module(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gaji_assert_hr() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.barapp_closing_assert_access() IS 'Internal authorization helper. Direct RPC execution revoked; called by guarded closing RPCs.';
COMMENT ON FUNCTION public.barapp_closing_module_snapshot(uuid, date, text) IS 'Internal closing snapshot helper. Direct RPC execution revoked; called by guarded closing RPCs.';
COMMENT ON FUNCTION public.cogs_assert_division_module(uuid, text) IS 'Internal module validator. Direct RPC execution revoked; called by guarded COGS RPCs.';
COMMENT ON FUNCTION public.gaji_assert_hr() IS 'Internal payroll authorization helper. Direct RPC execution revoked; called by guarded payroll RPCs.';
