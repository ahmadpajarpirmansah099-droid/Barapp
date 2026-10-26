-- Allow the Lazy Jennie HR account to use Guest Arrival for LJN only.
-- No user_scopes rows are added, so this does not broaden the account's other module scopes.

CREATE OR REPLACE FUNCTION public.guest_arrival_can_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT COALESCE(
    public.app_role() = 'dev'
    OR (
      public.app_role() = 'guest_arrival'
      AND EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.user_id = auth.uid()
          AND up.active
          AND up.role = 'guest_arrival'
          AND lower(up.email) = lower(COALESCE(auth.jwt() ->> 'email',''))
          AND lower(up.email) IN ('admin@div.service','admin@mnk.service')
          AND (
            SELECT count(DISTINCT s.outlet_id)
            FROM public.user_scopes s
            JOIN public.outlets o ON o.id=s.outlet_id AND o.active
            WHERE s.user_id=up.user_id
          ) = 1
      )
    )
    OR (
      public.app_role() = 'hr'
      AND EXISTS (
        SELECT 1
        FROM public.user_profiles up
        JOIN public.outlets o ON o.code='LJN' AND o.active
        WHERE up.user_id=auth.uid()
          AND up.active
          AND up.role='hr'
          AND lower(up.email)='admin@lazy.jennie'
          AND lower(up.email)=lower(COALESCE(auth.jwt()->>'email',''))
      )
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_current_outlet()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_outlet uuid;
BEGIN
  IF public.app_role() = 'dev' OR NOT public.guest_arrival_can_access() THEN
    RETURN NULL;
  END IF;

  IF public.app_role() = 'hr'
     AND lower(COALESCE(auth.jwt()->>'email',''))='admin@lazy.jennie' THEN
    SELECT o.id INTO v_outlet
    FROM public.outlets o
    WHERE o.code='LJN' AND o.active
    LIMIT 1;
    RETURN v_outlet;
  END IF;

  SELECT min(s.outlet_id::text)::uuid
  INTO v_outlet
  FROM public.user_scopes s
  JOIN public.outlets o ON o.id=s.outlet_id AND o.active
  WHERE s.user_id=auth.uid();

  RETURN v_outlet;
END;
$function$;

NOTIFY pgrst, 'reload schema';
