-- Disable legacy employee PIN authentication and PIN management endpoints.
-- Function bodies are intentionally retained for rollback/reference; only public app execution is revoked.
-- The previous index.html remains recoverable from Git history.
REVOKE EXECUTE ON FUNCTION public.staff_login(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_attendance(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_me(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_logout(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_set_pin(text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.staff_login(text, text) IS 'Legacy employee PIN login disabled for anon/authenticated; body retained for rollback/reference.';
COMMENT ON FUNCTION public.staff_attendance(text) IS 'Legacy employee PIN attendance endpoint disabled for anon/authenticated; body retained for rollback/reference.';
COMMENT ON FUNCTION public.staff_me(text) IS 'Legacy employee PIN session endpoint disabled for anon/authenticated; body retained for rollback/reference.';
COMMENT ON FUNCTION public.staff_logout(text) IS 'Legacy employee PIN logout endpoint disabled for anon/authenticated; body retained for rollback/reference.';
COMMENT ON FUNCTION public.staff_set_pin(text, text) IS 'Legacy employee PIN management disabled for anon/authenticated; body retained for rollback/reference.';
