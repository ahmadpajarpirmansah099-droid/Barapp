-- Disable employee PIN login and keep PIN verifier metadata server-only.
-- This migration does not delete employee, attendance, payroll, or PIN data.
-- Apply only after a restorable backup and staging regression tests are verified.

BEGIN;

-- Remove callable employee PIN login/session endpoints from browser-facing roles.
REVOKE EXECUTE ON FUNCTION public.staff_login(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_me(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_attendance(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_logout(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_set_pin(text, text) FROM PUBLIC, anon, authenticated;

-- Remove broad browser read/write access to employees and grant only the columns
-- used by the admin UI. Existing DELETE privilege and row-level policies are unchanged.
REVOKE SELECT, INSERT, UPDATE ON TABLE public.employees FROM authenticated;
REVOKE SELECT (pin_hash, pin_fail, pin_locked_until, pin_set_at),
       INSERT (pin_hash, pin_fail, pin_locked_until, pin_set_at),
       UPDATE (pin_hash, pin_fail, pin_locked_until, pin_set_at)
  ON TABLE public.employees FROM authenticated;

GRANT SELECT (id, name, role, active, created_at, outlet_id, division_id, deleted_at)
  ON TABLE public.employees TO authenticated;
GRANT INSERT (name, role, active, outlet_id, division_id)
  ON TABLE public.employees TO authenticated;
GRANT UPDATE (name, role, active, deleted_at)
  ON TABLE public.employees TO authenticated;

COMMIT;
