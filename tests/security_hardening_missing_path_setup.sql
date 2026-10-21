-- This fixture should cause the security hardening migration to abort.
CREATE OR REPLACE FUNCTION public.safe_path_probe()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$ SELECT 'safe'::text $function$;

CREATE OR REPLACE FUNCTION public.missing_path_probe()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
AS $function$ SELECT 'unsafe-default'::text $function$;
