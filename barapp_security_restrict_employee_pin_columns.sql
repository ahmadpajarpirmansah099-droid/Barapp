-- Barapp security hardening: hide employee PIN verifier and lockout metadata from the client API.
--
-- IMPORTANT ORDER:
-- 1) Deploy the frontend revision that uses EMP_SAFE_SELECT for all employees queries.
-- 2) Test employee load/create/edit/activate/import on a test account.
-- 3) Only then apply this migration to production, after a restorable backup is verified.
--
-- PIN verification remains inside SECURITY DEFINER staff RPCs owned by the database role.
-- RLS continues to control which employee rows authenticated users may access.
-- Column privileges restrict those rows to non-secret fields.

BEGIN;

-- Remove broad table-level SELECT, then explicitly grant only fields the frontend needs.
REVOKE SELECT ON TABLE public.employees FROM authenticated;

-- Remove any pre-existing column-level SELECT grants on sensitive PIN fields as well.
REVOKE SELECT (pin_hash, pin_fail, pin_locked_until, pin_set_at)
  ON TABLE public.employees FROM authenticated;

GRANT SELECT (id, name, role, active, created_at, outlet_id, division_id, deleted_at)
  ON TABLE public.employees TO authenticated;

COMMIT;
