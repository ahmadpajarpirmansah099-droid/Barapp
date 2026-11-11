-- Barapp security hardening: keep employee PIN verifier/lockout fields server-only.
--
-- IMPORTANT ORDER:
-- 1) Deploy the frontend revision that uses EMP_SAFE_SELECT for employee queries and
--    explicit safe projections for employee insert/update responses.
-- 2) Test employee load/create/edit/activate/deactivate/import with authorized accounts.
-- 3) Only then apply this migration to production, after a restorable backup is verified.
--
-- PIN fields remain managed by the existing SECURITY DEFINER staff RPCs.
-- Existing RLS policies still control which employee rows authenticated users may access.

BEGIN;

-- Remove broad table-level read/write privileges. Keep existing DELETE privilege unchanged.
REVOKE SELECT, INSERT, UPDATE ON TABLE public.employees FROM authenticated;

-- Remove any explicit column-level grants on sensitive PIN fields too.
REVOKE SELECT (pin_hash, pin_fail, pin_locked_until, pin_set_at),
       INSERT (pin_hash, pin_fail, pin_locked_until, pin_set_at),
       UPDATE (pin_hash, pin_fail, pin_locked_until, pin_set_at)
  ON TABLE public.employees FROM authenticated;

-- Client read projection: only fields used by the app, never PIN/hash/lockout metadata.
GRANT SELECT (id, name, role, active, created_at, outlet_id, division_id, deleted_at)
  ON TABLE public.employees TO authenticated;

-- Client create fields. PIN metadata uses its server-side defaults and is set through staff RPCs.
GRANT INSERT (name, role, active, outlet_id, division_id)
  ON TABLE public.employees TO authenticated;

-- Client edit fields used by Barapp UI. PIN metadata and scope fields cannot be changed directly.
GRANT UPDATE (name, role, active, deleted_at)
  ON TABLE public.employees TO authenticated;

COMMIT;
