\set ON_ERROR_STOP on

-- Isolated test fixture for local/GitHub Actions PostgreSQL only.
-- This deliberately creates minimal mock prerequisites; it is not a production migration.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE
AS $$ SELECT jsonb_build_object('email', nullif(current_setting('request.jwt.claim.email', true), '')) $$;

CREATE TABLE public.barapp_closing_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL,
  division_id uuid NOT NULL,
  closing_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  UNIQUE (division_id, closing_date)
);

CREATE TABLE public.barapp_closing_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id uuid NOT NULL,
  module_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_by uuid,
  confirmed_at timestamptz,
  note text,
  UNIQUE (closing_id, module_key)
);

CREATE TABLE public.audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  actor_email text,
  action text NOT NULL,
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  reason text
);

CREATE TABLE public.divisions (
  id uuid PRIMARY KEY,
  outlet_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true
);

-- A sentinel table demonstrates that the reopen RPC does not mutate unrelated
-- operational records. It is a test fixture, not part of the production schema.
CREATE TABLE public.test_operational_sentinel (
  id text PRIMARY KEY,
  quantity integer NOT NULL
);

CREATE FUNCTION public.app_role() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.test_role', true), '') $$;

CREATE FUNCTION public.barapp_closing_assert_access() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.app_role(), '') NOT IN ('dev', 'div_admin') THEN
    RAISE EXCEPTION 'CLOSING_ACCESS_DENIED' USING errcode = '42501';
  END IF;
END
$function$;

CREATE FUNCTION public.barapp_closing_can_access_division(p_division_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT p_division_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND coalesce(public.app_role(), '') IN ('dev', 'div_admin')
$function$;

GRANT EXECUTE ON FUNCTION public.app_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.barapp_closing_assert_access() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.barapp_closing_can_access_division(uuid) TO anon, authenticated;

CREATE FUNCTION public.barapp_can_access_division(p_division_id uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $can_access$
  SELECT p_division_id IS NOT NULL AND auth.uid() IS NOT NULL
     AND coalesce(public.app_role(), '') IN ('dev', 'div_admin')
$can_access$;

CREATE FUNCTION public.division_module_enabled(p_division_id uuid, p_module_key text) RETURNS boolean
LANGUAGE sql STABLE
AS $module_enabled$ SELECT false $module_enabled$;

CREATE FUNCTION public.barapp_closing_module_snapshot(
  p_division_id uuid, p_closing_date date, p_module_key text
) RETURNS jsonb
LANGUAGE sql STABLE
AS $module_snapshot$
  SELECT jsonb_build_object(
    'module_key', p_module_key,
    'date', p_closing_date::text,
    'fingerprint', 'ci-test-snapshot',
    'count', 0
  )
$module_snapshot$;

-- Approval summary references these columns even when COGS/Daily SO is disabled
-- in this isolated fixture. The production stock movement logic is not exercised.
CREATE TABLE public.cogs_daily_so_lines (
  so_id uuid,
  variance_qty_base numeric DEFAULT 0,
  variance_value_snapshot numeric DEFAULT 0
);

-- Minimal transaction table fixtures for the checked-in reconciliation-trigger migration.
CREATE TABLE public.barapp_stock_in (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL,
  received_at date NOT NULL,
  status text NOT NULL DEFAULT 'posted'
);
CREATE TABLE public.barapp_stock_out (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_division_id uuid,
  to_division_id uuid,
  out_date date,
  category text,
  status text NOT NULL DEFAULT 'posted'
);
CREATE TABLE public.barapp_stock_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL,
  returned_at date NOT NULL,
  status text NOT NULL DEFAULT 'posted'
);
CREATE TABLE public.barapp_supplies_so (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL,
  so_date date NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
);
CREATE TABLE public.barapp_supplies_so_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id uuid
);
CREATE TABLE public.cogs_daily_so (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL,
  so_date date NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
);
CREATE TABLE public.cogs_menu_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL,
  sold_at date NOT NULL,
  status text NOT NULL DEFAULT 'posted'
);
CREATE TABLE public.cogs_menu_sales_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid
);
CREATE TABLE public.cogs_production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL,
  produced_at date NOT NULL,
  status text NOT NULL DEFAULT 'posted'
);
CREATE TABLE public.cogs_production_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid
);

-- Install repository-owned triggers in the disposable CI database only.
\ir ../barapp_closing_reconciliation_triggers_v1.sql

-- Resolve a Jakarta-local date and seed one approved period, four module snapshots,
-- plus an unrelated operational sentinel row.
SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS test_closing_date \gset
\set test_division_id 22222222-2222-2222-2222-222222222222
\set test_outlet_id 33333333-3333-3333-3333-333333333333
\set test_period_id 44444444-4444-4444-4444-444444444444
\set test_actor_id 55555555-5555-5555-5555-555555555555
\set prior_approver_id 66666666-6666-6666-6666-666666666666

-- UPDATE regression: changing a transaction date must dirty BOTH the old and new
-- approved closing periods. Seed the transaction before periods so INSERT does not
-- pre-dirty the test periods.
INSERT INTO public.divisions (id,outlet_id,active)
VALUES ('77777777-7777-7777-7777-777777777777','88888888-8888-8888-8888-888888888888',true);

INSERT INTO public.barapp_stock_in(id,division_id,received_at,status)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '77777777-7777-7777-7777-777777777777',
  (now() AT TIME ZONE 'Asia/Jakarta')::date - 1,
  'posted'
);

INSERT INTO public.barapp_closing_periods
  (id,outlet_id,division_id,closing_date,status,approved_by,approved_at)
VALUES
  ('99999999-9999-9999-9999-999999999991','88888888-8888-8888-8888-888888888888',
   '77777777-7777-7777-7777-777777777777',(now() AT TIME ZONE 'Asia/Jakarta')::date - 1,
   'approved','66666666-6666-6666-6666-666666666666',now()-interval '1 hour'),
  ('99999999-9999-9999-9999-999999999992','88888888-8888-8888-8888-888888888888',
   '77777777-7777-7777-7777-777777777777',(now() AT TIME ZONE 'Asia/Jakarta')::date,
   'approved','66666666-6666-6666-6666-666666666666',now()-interval '1 hour');

UPDATE public.barapp_stock_in
SET received_at=(now() AT TIME ZONE 'Asia/Jakarta')::date
WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

DO $trigger_update_test$
DECLARE
  v_old_status text;
  v_new_status text;
  v_audit_count integer;
BEGIN
  SELECT status INTO STRICT v_old_status
  FROM public.barapp_closing_periods
  WHERE id='99999999-9999-9999-9999-999999999991';
  SELECT status INTO STRICT v_new_status
  FROM public.barapp_closing_periods
  WHERE id='99999999-9999-9999-9999-999999999992';
  SELECT count(*) INTO v_audit_count
  FROM public.audit_log
  WHERE action='closing_marked_needs_reconciliation'
    AND record_id IN (
      '99999999-9999-9999-9999-999999999991',
      '99999999-9999-9999-9999-999999999992'
    )
    AND reason LIKE '%barapp_stock_in%';

  IF v_old_status <> 'needs_reconciliation'
     OR v_new_status <> 'needs_reconciliation'
     OR v_audit_count <> 2 THEN
    RAISE EXCEPTION 'TEST_FAILURE: UPDATE must reconcile old and new dates (old %, new %, audit %)',
      v_old_status,v_new_status,v_audit_count;
  END IF;
END
$trigger_update_test$;

INSERT INTO public.divisions (id,outlet_id,active)
VALUES (:'test_division_id'::uuid, :'test_outlet_id'::uuid, true);

INSERT INTO public.barapp_closing_periods
  (id, outlet_id, division_id, closing_date, status, created_by, approved_by, approved_at, summary, notes)
VALUES
  (:'test_period_id'::uuid, :'test_outlet_id'::uuid, :'test_division_id'::uuid,
   :'test_closing_date'::date, 'approved', :'test_actor_id'::uuid,
   :'prior_approver_id'::uuid, now() - interval '1 hour',
   jsonb_build_object('approved_by', :'prior_approver_id', 'approved_at', now() - interval '1 hour'),
   'seeded test period');

INSERT INTO public.barapp_closing_modules
  (closing_id, module_key, status, snapshot, confirmed_by, confirmed_at, note)
VALUES
  (:'test_period_id'::uuid, 'daily_so', 'confirmed',
   '{"fingerprint":"daily-before","count":3}', :'test_actor_id'::uuid, now(), 'Daily SO snapshot'),
  (:'test_period_id'::uuid, 'sales', 'confirmed',
   '{"fingerprint":"sales-before","count":2}', :'test_actor_id'::uuid, now(), 'Sales snapshot'),
  (:'test_period_id'::uuid, 'pengeluaran', 'confirmed',
   '{"fingerprint":"expense-before","count":1}', :'test_actor_id'::uuid, now(), 'Expense snapshot'),
  (:'test_period_id'::uuid, 'barang_masuk', 'confirmed',
   '{"fingerprint":"stockin-before","count":1}', :'test_actor_id'::uuid, now(), 'Stock-in snapshot');

INSERT INTO public.test_operational_sentinel(id, quantity) VALUES ('keep-me', 17);

-- Load the actual approval/confirmation RPC definitions from this repository.
\ir ../barapp_closing_daily_so_item_guard_v1.sql
\ir ../barapp_closing_reopen_v1.sql

SELECT set_config('request.jwt.claim.sub', :'test_actor_id', false);
SELECT set_config('request.jwt.claim.email', 'closing-test@example.invalid', false);
SELECT set_config('app.test_role', 'dev', false);

SET ROLE authenticated;
SELECT public.barapp_closing_reopen(
  :'test_division_id'::uuid,
  :'test_closing_date'::date,
  'CI test: cancellation regression'
);
RESET ROLE;

DO $test$
DECLARE
  v_period public.barapp_closing_periods%ROWTYPE;
  v_module_count integer;
  v_audit public.audit_log%ROWTYPE;
  v_operational_quantity integer;
  v_rpc_oid oid;
BEGIN
  SELECT * INTO STRICT v_period
    FROM public.barapp_closing_periods
   WHERE id = '44444444-4444-4444-4444-444444444444'::uuid;

  IF v_period.status <> 'needs_reconciliation'
     OR v_period.approved_by IS NOT NULL
     OR v_period.approved_at IS NOT NULL
     OR v_period.summary <> '{}'::jsonb THEN
    RAISE EXCEPTION 'TEST_FAILURE: period approval state was not safely reset';
  END IF;

  SELECT count(*) INTO v_module_count
    FROM public.barapp_closing_modules
   WHERE closing_id = v_period.id
     AND status = 'pending'
     AND snapshot = '{}'::jsonb
     AND confirmed_by IS NULL
     AND confirmed_at IS NULL
     AND note IS NULL;
  IF v_module_count <> 4 THEN
    RAISE EXCEPTION 'TEST_FAILURE: expected both module snapshots to reset, got %', v_module_count;
  END IF;

  SELECT * INTO STRICT v_audit
    FROM public.audit_log
   WHERE action = 'closing_approval_cancelled'
     AND record_id = v_period.id::text;

  IF v_audit.reason <> 'CI test: cancellation regression'
     OR v_audit.old_data->'period'->>'status' <> 'approved'
     OR v_audit.old_data->'period'->>'approved_by' IS NULL
     OR v_audit.old_data->'period'->>'approved_at' IS NULL
     OR jsonb_array_length(v_audit.old_data->'module_snapshots') <> 4
     OR v_audit.new_data->>'status' <> 'needs_reconciliation' THEN
    RAISE EXCEPTION 'TEST_FAILURE: audit log did not preserve the previous approved state and module snapshots';
  END IF;

  SELECT quantity INTO STRICT v_operational_quantity
    FROM public.test_operational_sentinel WHERE id='keep-me';
  IF v_operational_quantity <> 17 THEN
    RAISE EXCEPTION 'TEST_FAILURE: unrelated operational sentinel changed';
  END IF;

  v_rpc_oid := to_regprocedure('public.barapp_closing_reopen(uuid,date,text)');
  IF v_rpc_oid IS NULL
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_rpc_oid)
     OR NOT has_function_privilege('authenticated', v_rpc_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_rpc_oid, 'EXECUTE')
     OR NOT (SELECT pg_get_functiondef(v_rpc_oid) LIKE '%SET search_path TO ''pg_catalog'', ''pg_temp''%') THEN
    RAISE EXCEPTION 'TEST_FAILURE: RPC security/search_path/execute grants are incorrect';
  END IF;
END
$test$;

-- Invalid input and unauthorized attempts must fail with the expected messages.
SELECT set_config('app.test_role', 'staff', false);
DO $test$
BEGIN
  BEGIN
    PERFORM public.barapp_closing_reopen(
      '22222222-2222-2222-2222-222222222222'::uuid,
      (now() AT TIME ZONE 'Asia/Jakarta')::date,
      'unauthorized test'
    );
    RAISE EXCEPTION 'TEST_FAILURE: unauthorized caller unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CLOSING_ACCESS_DENIED' THEN RAISE; END IF;
  END;
END
$test$;

SELECT set_config('app.test_role', 'dev', false);
DO $test$
BEGIN
  BEGIN
    PERFORM public.barapp_closing_reopen(
      '22222222-2222-2222-2222-222222222222'::uuid,
      (now() AT TIME ZONE 'Asia/Jakarta')::date,
      '   '
    );
    RAISE EXCEPTION 'TEST_FAILURE: blank reason unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CLOSING_REASON_REQUIRED' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.barapp_closing_reopen(
      '22222222-2222-2222-2222-222222222222'::uuid,
      (now() AT TIME ZONE 'Asia/Jakarta')::date,
      repeat('x', 501)
    );
    RAISE EXCEPTION 'TEST_FAILURE: oversized reason unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CLOSING_REASON_TOO_LONG' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.barapp_closing_reopen(
      '22222222-2222-2222-2222-222222222222'::uuid,
      (now() AT TIME ZONE 'Asia/Jakarta')::date,
      'second cancellation must be rejected'
    );
    RAISE EXCEPTION 'TEST_FAILURE: non-approved period unexpectedly reopened again';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CLOSING_NOT_APPROVED' THEN RAISE; END IF;
  END;
END
$test$;

-- Reconfirm the two required modules through the actual repository RPC.
-- Empty confirmation is explicit because this isolated fixture has no operational
-- rows; optional COGS/Daily SO modules stay disabled for this lifecycle test.
SET ROLE authenticated;
SELECT public.barapp_closing_confirm_module(
  :'test_division_id'::uuid, :'test_closing_date'::date,
  'pengeluaran', true, 'CI empty confirmation'
);
SELECT public.barapp_closing_confirm_module(
  :'test_division_id'::uuid, :'test_closing_date'::date,
  'barang_masuk', true, 'CI empty confirmation'
);
RESET ROLE;

DO $test$
DECLARE
  v_status text;
  v_confirmed_count integer;
BEGIN
  SELECT status INTO STRICT v_status
    FROM public.barapp_closing_periods
   WHERE id='44444444-4444-4444-4444-444444444444'::uuid;
  SELECT count(*) INTO v_confirmed_count
    FROM public.barapp_closing_modules
   WHERE closing_id='44444444-4444-4444-4444-444444444444'::uuid
     AND module_key IN ('pengeluaran','barang_masuk')
     AND status='confirmed_empty'
     AND confirmed_by='55555555-5555-5555-5555-555555555555'::uuid
     AND confirmed_at IS NOT NULL
     AND snapshot->>'fingerprint'='ci-test-snapshot';
  IF v_status <> 'ready' OR v_confirmed_count <> 2 THEN
    RAISE EXCEPTION 'TEST_FAILURE: actual confirmation RPC did not re-confirm required modules (status %, confirmed %)',v_status,v_confirmed_count;
  END IF;
END
$test$;

SET ROLE authenticated;
SELECT public.barapp_closing_approve(
  :'test_division_id'::uuid,
  :'test_closing_date'::date,
  'CI test: re-approval after reconfirmation'
);
RESET ROLE;

DO $test$
DECLARE
  v_period public.barapp_closing_periods%ROWTYPE;
  v_approval_audit public.audit_log%ROWTYPE;
  v_operational_quantity integer;
BEGIN
  SELECT * INTO STRICT v_period
    FROM public.barapp_closing_periods
   WHERE id='44444444-4444-4444-4444-444444444444'::uuid;

  IF v_period.status <> 'approved'
     OR v_period.approved_by <> '55555555-5555-5555-5555-555555555555'::uuid
     OR v_period.approved_at IS NULL
     OR v_period.summary = '{}'::jsonb THEN
    RAISE EXCEPTION 'TEST_FAILURE: re-approval did not restore approved status and metadata';
  END IF;

  SELECT * INTO STRICT v_approval_audit
    FROM public.audit_log
   WHERE action='closing_approved'
     AND record_id=v_period.id::text;
  IF v_approval_audit.new_data->>'status' <> 'approved'
     OR v_approval_audit.reason <> 'CI test: re-approval after reconfirmation' THEN
    RAISE EXCEPTION 'TEST_FAILURE: re-approval audit record missing or incorrect';
  END IF;

  IF (SELECT count(*) FROM public.audit_log WHERE action='closing_approval_cancelled') <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILURE: cancellation audit count changed unexpectedly';
  END IF;

  SELECT quantity INTO STRICT v_operational_quantity
    FROM public.test_operational_sentinel WHERE id='keep-me';
  IF v_operational_quantity <> 17
     OR (SELECT count(*) FROM public.cogs_daily_so_lines) <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILURE: re-approval unexpectedly created or changed operational movement data';
  END IF;

  RAISE NOTICE 'PASS: closing reopen, invalid-input guards, re-approval lifecycle, and no extra movement';
END
$test$;
