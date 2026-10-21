-- Isolated fixture for barapp_security_hardening_v1.sql.
-- Run in a disposable PostgreSQL database only.
CREATE SCHEMA auth;
CREATE SCHEMA extensions;

CREATE TABLE public.path_probe(value text NOT NULL);
INSERT INTO public.path_probe(value) VALUES ('trusted-public-object');

CREATE OR REPLACE FUNCTION public.path_probe_value()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_value text;
BEGIN
  -- Dynamic SQL forces relation lookup at invocation time and reproduces pg_temp shadowing.
  EXECUTE 'SELECT value FROM path_probe ORDER BY value LIMIT 1' INTO v_value;
  RETURN v_value;
END;
$function$;

CREATE OR REPLACE FUNCTION public.path_probe_with_auth()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
  SELECT 'auth-path-preserved'::text
$function$;

CREATE OR REPLACE FUNCTION public.path_probe_with_extensions()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = extensions, public, auth
AS $function$
  SELECT 'extensions-path-preserved'::text
$function$;

-- Mirrors the live rls_auto_enable() path pattern; this function needs catalog only.
CREATE OR REPLACE FUNCTION public.path_probe_catalog_only()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT current_schema()::text
$function$;
