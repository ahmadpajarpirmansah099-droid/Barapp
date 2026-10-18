-- BarApp Security Hardening V1
-- Purpose: harden SECURITY DEFINER routines against temporary-object shadowing.
-- This migration changes function configuration only; it does not alter operational rows.
-- Apply only to a verified staging database first. Preserve existing function grants:
-- staff_login/staff_attendance/staff_me/staff_logout intentionally support the staff
-- token/PIN flow and are NOT revoked from anon by this migration.
--
-- PostgreSQL may search pg_temp first for relation/type names unless pg_temp is
-- explicitly placed last in a SECURITY DEFINER function's search_path. This migration
-- preserves the trusted schemas already configured, makes pg_catalog explicit first,
-- and explicitly places pg_temp last.

begin;

do $barapp_security_definer_path_hardening$
declare
  r record;
  v_schema text;
  v_new_path text;
begin
  -- Keep this maintenance block independent of caller-controlled search paths.
  perform set_config('search_path', 'pg_catalog', true);

  -- Fail closed if any public SECURITY DEFINER routine lacks a fixed search_path.
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as settings(setting)
        where settings.setting like 'search_path=%'
      )
  ) then
    raise exception 'BARAPP_SECURITY_DEFINER_MISSING_SEARCH_PATH: inspect public SECURITY DEFINER routines before hardening';
  end if;

  -- Only trusted schemas observed in this project are accepted. Unexpected schema
  -- entries abort the transaction rather than being silently removed from a path.
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) as settings(setting)
    cross join lateral unnest(
      regexp_split_to_array(
        substring(settings.setting from length('search_path=') + 1),
        ','
      )
    ) as paths(schema_name)
    where n.nspname = 'public'
      and p.prosecdef
      and settings.setting like 'search_path=%'
      and btrim(paths.schema_name) not in ('pg_catalog', 'public', 'auth', 'extensions', 'pg_temp')
  ) then
    raise exception 'BARAPP_SECURITY_DEFINER_UNEXPECTED_SCHEMA: review existing SECURITY DEFINER search_path values before applying';
  end if;

  for r in
    select
      p.oid::regprocedure as signature,
      substring(settings.setting from length('search_path=') + 1) as current_path
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) as settings(setting)
    where n.nspname = 'public'
      and p.prosecdef
      and settings.setting like 'search_path=%'
  loop
    v_new_path := 'pg_catalog';

    foreach v_schema in array regexp_split_to_array(r.current_path, ',')
    loop
      v_schema := btrim(v_schema);

      if v_schema in ('public', 'auth', 'extensions')
         and position(', ' || v_schema in v_new_path) = 0 then
        v_new_path := v_new_path || ', ' || v_schema;
      end if;
    end loop;

    v_new_path := v_new_path || ', pg_temp';

    execute format(
      'alter function %s set search_path to %s',
      r.signature,
      v_new_path
    );
  end loop;

  -- Post-condition: every public SECURITY DEFINER routine starts with pg_catalog
  -- and explicitly places pg_temp last.
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) as settings(setting)
    where n.nspname = 'public'
      and p.prosecdef
      and settings.setting like 'search_path=%'
      and (
        substring(settings.setting from length('search_path=') + 1) not like 'pg_catalog,%'
        or right(
          rtrim(substring(settings.setting from length('search_path=') + 1)),
          length('pg_temp')
        ) <> 'pg_temp'
      )
  ) then
    raise exception 'BARAPP_SECURITY_DEFINER_PATH_VERIFICATION_FAILED: search_path post-condition did not pass';
  end if;
end;
$barapp_security_definer_path_hardening$;

commit;
