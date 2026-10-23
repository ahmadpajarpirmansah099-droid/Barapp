-- Restore authenticated access to the snapshot RPC used directly by the Approval Closing UI.
-- Keep anonymous/public access revoked; the function still enforces developer/division-admin authorization internally.
REVOKE EXECUTE ON FUNCTION public.barapp_closing_module_snapshot(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.barapp_closing_module_snapshot(uuid, date, text) TO authenticated;
COMMENT ON FUNCTION public.barapp_closing_module_snapshot(uuid, date, text) IS 'Approval Closing UI RPC; authenticated execution is allowed because the function enforces developer/admin and division-scope authorization internally.';
