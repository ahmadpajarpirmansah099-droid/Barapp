-- Assertions run after barapp_security_hardening_v1.sql in an isolated database.
CREATE TEMP TABLE path_probe(value text NOT NULL);
INSERT INTO path_probe(value) VALUES ('attacker-temp-object');

DO $assert$
DECLARE
  v_total integer;
  v_missing integer;
  v_unhardened integer;
  v_path text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE function_path IS NULL),
         count(*) FILTER (
           WHERE function_path IS NULL
              OR split_part(btrim(function_path), ',', 1) <> 'pg_catalog'
              OR right(rtrim(function_path), 7) <> 'pg_temp'
         )
    INTO v_total, v_missing, v_unhardened
  FROM (
    SELECT p.oid,
      (SELECT substring(settings.setting FROM length('search_path=') + 1)
         FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS settings(setting)
        WHERE settings.setting LIKE 'search_path=%'
        LIMIT 1) AS function_path
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  ) sd;

  IF v_total <> 3 OR v_missing <> 0 OR v_unhardened <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILURE: expected 3 hardened functions (total=%, missing=%, unhardened=%)',
      v_total, v_missing, v_unhardened;
  END IF;

  SELECT substring(settings.setting FROM length('search_path=') + 1) INTO v_path
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
  WHERE n.nspname='public' AND p.proname='path_probe_with_auth'
    AND cfg LIKE 'search_path=%';
  IF v_path <> 'pg_catalog, public, auth, pg_temp' THEN
    RAISE EXCEPTION 'TEST_FAILURE: expected auth schema retained in fixed path, got %', v_path;
  END IF;

  SELECT substring(settings.setting FROM length('search_path=') + 1) INTO v_path
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
  WHERE n.nspname='public' AND p.proname='path_probe_with_extensions'
    AND cfg LIKE 'search_path=%';
  IF v_path <> 'pg_catalog, extensions, public, auth, pg_temp' THEN
    RAISE EXCEPTION 'TEST_FAILURE: trusted schema order not preserved, got %', v_path;
  END IF;

  IF public.path_probe_value() <> 'trusted-public-object' THEN
    RAISE EXCEPTION 'TEST_FAILURE: temporary object shadowed trusted public relation';
  END IF;
  RAISE NOTICE 'PASS: SECURITY DEFINER paths are hardened, trusted schemas preserved, and pg_temp cannot shadow public relations.';
END;
$assert$;
