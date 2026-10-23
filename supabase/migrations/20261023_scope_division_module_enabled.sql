-- Restrict module-configuration lookup to authenticated users who can access
-- the division through inventory scope or the scoped COGS access model.
-- This helper is used by RLS policies and guarded SECURITY DEFINER RPCs, so
-- retain EXECUTE for authenticated while enforcing scope inside the function.
CREATE OR REPLACE FUNCTION public.division_module_enabled(p_division_id uuid, p_module text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.barapp_can_access_division(p_division_id)
      OR public.cogs_ops_can_access_division(p_division_id)
    )
    AND CASE
      WHEN p_module = 'inventory' THEN true
      WHEN p_module = ANY (ARRAY['supplies','cogs_materials','cogs_daily_so','cogs_wip','cogs_menu','cogs_production','cogs_sales','closing'])
        THEN coalesce((d.module_config ->> p_module)::boolean, false)
      ELSE false
    END
  FROM public.divisions d
  WHERE d.id = p_division_id;
$function$;
