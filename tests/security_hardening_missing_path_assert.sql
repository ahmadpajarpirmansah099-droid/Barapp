DO $assert$
DECLARE
  v_path text;
BEGIN
  SELECT substring(cfg FROM length('search_path=') + 1) INTO v_path
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
  WHERE n.nspname='public' AND p.proname='safe_path_probe'
    AND cfg LIKE 'search_path=%';

  IF v_path <> 'public' THEN
    RAISE EXCEPTION 'TEST_FAILURE: hardening migration partially changed state despite fail-closed preflight; path=%', v_path;
  END IF;
  RAISE NOTICE 'PASS: missing SECURITY DEFINER search_path aborts before any function is modified.';
END;
$assert$;
