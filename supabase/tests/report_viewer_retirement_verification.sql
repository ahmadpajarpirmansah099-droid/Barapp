-- Barapp: read-only verification after applying 20261030120700_remove_report_viewer_role.
-- Every statement below is SELECT-only. No data or schema is changed.
-- Expected: zero report_viewer accounts, functions, and RLS policy references.

-- 1) Account totals by role/status; no personal data is returned.
SELECT role, active, COUNT(*)::integer AS account_count
FROM public.user_profiles
GROUP BY role, active
ORDER BY role, active;

-- 2) Must return account_count = 0.
SELECT COUNT(*)::integer AS report_viewer_account_count
FROM public.user_profiles
WHERE role = 'report_viewer';

-- 3) Must return role_constraint_ok = true and no report_viewer token.
SELECT
  conname,
  pg_get_constraintdef(oid) AS definition,
  POSITION('report_viewer' IN pg_get_constraintdef(oid)) = 0 AS role_constraint_ok
FROM pg_constraint
WHERE conrelid = 'public.user_profiles'::regclass
  AND conname = 'user_profiles_role_check';

-- 4) Must return zero rows.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND p.prokind = 'f'
  AND pg_get_functiondef(p.oid) ILIKE '%report_viewer%'
ORDER BY n.nspname, p.proname;

-- 5) Must return zero rows.
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE COALESCE(qual, '') ILIKE '%report_viewer%'
   OR COALESCE(with_check, '') ILIKE '%report_viewer%'
ORDER BY schemaname, tablename, policyname;

-- 6) Must return assignment_rpc_removed = true.
SELECT
  to_regprocedure('public.dev_assign_report_viewer(text)') IS NULL
    AS assignment_rpc_removed;

-- 7) The four existing access policies must remain present and contain no retired role.
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE (schemaname, policyname) IN (
  ('public', 'p_att_delete_feature'),
  ('public', 'p_div_sel'),
  ('public', 'p_att_select_feature'),
  ('public', 'p_emp_select_feature')
)
ORDER BY tablename, policyname;

-- 8) These independent HR feature permissions must remain intact.
-- Counts are aggregated; user IDs and personal details are not exposed.
SELECT p.role, p.active, up.permission, COUNT(DISTINCT up.user_id)::integer AS account_count
FROM public.user_permissions up
JOIN public.user_profiles p ON p.user_id = up.user_id
WHERE up.permission IN ('attendance.report.view', 'employees.directory.view')
GROUP BY p.role, p.active, up.permission
ORDER BY p.role, p.active, up.permission;
