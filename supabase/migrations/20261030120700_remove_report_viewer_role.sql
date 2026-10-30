BEGIN;

-- Refuse to remove the role constraint if an account still depends on it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE role = 'report_viewer'
  ) THEN
    RAISE EXCEPTION 'report_viewer accounts still exist; reconcile accounts before removing the role';
  END IF;
END
$$;

-- Preserve all existing supported roles, including Guest Arrival (Service)
-- and the legacy_admin compatibility role.
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role = ANY (ARRAY[
    'dev'::text,
    'hr'::text,
    'div_admin'::text,
    'legacy_admin'::text,
    'guest_arrival'::text
  ]));

CREATE OR REPLACE FUNCTION public.has_perm(p text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE public.app_role()
    WHEN 'dev' THEN true
    WHEN 'hr' THEN EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = auth.uid() AND permission = p
    )
    WHEN 'div_admin' THEN EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = auth.uid() AND permission = p
    )
    WHEN 'legacy_admin' THEN EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = auth.uid() AND permission = p
    )
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION public.can_access_scope(p_outlet uuid, p_division uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.app_role() = 'dev' THEN true
    WHEN public.app_role() IN ('hr', 'div_admin') THEN EXISTS (
      SELECT 1
      FROM public.user_scopes s
      WHERE s.user_id = auth.uid()
        AND s.outlet_id = p_outlet
        AND (s.division_id IS NULL OR s.division_id = p_division)
    )
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION public.barapp_can_access_division(p_division_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.divisions d
      WHERE d.id = p_division_id
        AND (
          public.app_role() = 'dev'
          OR (
            public.app_role() IN ('hr', 'div_admin')
            AND public.can_access_scope(d.outlet_id, d.id)
          )
          OR public.app_role() = 'legacy_admin'
        )
    )
$function$;

CREATE OR REPLACE FUNCTION public.cogs_ops_can_access_division(p_division_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.divisions d
      WHERE d.id = p_division_id
        AND d.has_cogs = true
        AND (
          public.app_role() = 'dev'
          OR (
            public.app_role() IN ('hr', 'div_admin')
            AND public.can_access_scope(d.outlet_id, d.id)
            AND (
              public.has_perm('cogs.daily_so.system')
              OR public.has_perm('cogs.daily_so.difference')
              OR public.has_perm('cogs.daily_so.edit')
              OR public.has_perm('cogs.production.view')
              OR public.has_perm('cogs.production.manage')
              OR public.has_perm('cogs.wip.view')
              OR public.has_perm('cogs.wip.manage')
              OR public.has_perm('cogs.menu.view')
              OR public.has_perm('cogs.menu.manage')
              OR public.has_perm('cogs.sales.view')
              OR public.has_perm('cogs.sales.manage')
            )
          )
          OR (
            public.app_role() = 'legacy_admin'
            AND (
              public.has_perm('cogs.daily_so.system')
              OR public.has_perm('cogs.daily_so.difference')
              OR public.has_perm('cogs.daily_so.edit')
              OR public.has_perm('cogs.production.view')
              OR public.has_perm('cogs.production.manage')
              OR public.has_perm('cogs.wip.view')
              OR public.has_perm('cogs.wip.manage')
              OR public.has_perm('cogs.menu.view')
              OR public.has_perm('cogs.menu.manage')
              OR public.has_perm('cogs.sales.view')
              OR public.has_perm('cogs.sales.manage')
            )
          )
        )
    )
$function$;

CREATE OR REPLACE FUNCTION public.cogs_assert_ops_division(p_division_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_role text := coalesce(public.app_role(), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'COGS_ADMIN_ONLY' USING errcode = '42501';
  END IF;

  IF v_role NOT IN ('dev', 'hr', 'div_admin', 'legacy_admin') THEN
    RAISE EXCEPTION 'COGS_ADMIN_ONLY' USING errcode = '42501';
  END IF;

  IF NOT public.cogs_ops_can_access_division(p_division_id) THEN
    RAISE EXCEPTION 'COGS_DIVISION_FORBIDDEN' USING errcode = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cogs_cancel_operation(
  p_kind text,
  p_id uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_division uuid;
BEGIN
  IF auth.uid() IS NULL
     OR coalesce(public.app_role(), '') NOT IN ('dev', 'hr', 'div_admin', 'legacy_admin') THEN
    RAISE EXCEPTION 'COGS_ADMIN_ONLY' USING errcode = '42501';
  END IF;

  IF lower(p_kind) = 'production' THEN
    SELECT division_id
    INTO v_division
    FROM public.cogs_production_batches
    WHERE id = p_id AND status = 'posted';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'COGS_OPERATION_NOT_FOUND';
    END IF;

    PERFORM public.cogs_assert_division_module(
      v_division,
      CASE lower(p_kind)
        WHEN 'production' THEN 'cogs_production'
        WHEN 'sale' THEN 'cogs_sales'
        ELSE 'cogs_daily_so'
      END
    );

    IF NOT public.has_perm('cogs.production.manage') THEN
      RAISE EXCEPTION 'COGS_FEATURE_PERMISSION_DENIED' USING errcode = '42501';
    END IF;

    UPDATE public.cogs_production_batches
    SET status = 'cancelled',
        cancelled_by = auth.uid(),
        cancelled_at = now(),
        notes = concat_ws(E'\\n', notes, nullif(trim(coalesce(p_reason, '')), ''))
    WHERE id = p_id AND status = 'posted';

  ELSIF lower(p_kind) = 'sale' THEN
    SELECT division_id
    INTO v_division
    FROM public.cogs_menu_sales
    WHERE id = p_id AND status = 'posted';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'COGS_OPERATION_NOT_FOUND';
    END IF;

    PERFORM public.cogs_assert_division_module(
      v_division,
      CASE lower(p_kind)
        WHEN 'production' THEN 'cogs_production'
        WHEN 'sale' THEN 'cogs_sales'
        ELSE 'cogs_daily_so'
      END
    );

    IF NOT public.has_perm('cogs.sales.manage') THEN
      RAISE EXCEPTION 'COGS_FEATURE_PERMISSION_DENIED' USING errcode = '42501';
    END IF;

    UPDATE public.cogs_menu_sales
    SET status = 'cancelled',
        cancelled_by = auth.uid(),
        cancelled_at = now(),
        notes = concat_ws(E'\\n', notes, nullif(trim(coalesce(p_reason, '')), ''))
    WHERE id = p_id AND status = 'posted';

  ELSIF lower(p_kind) = 'daily_so' THEN
    SELECT division_id
    INTO v_division
    FROM public.cogs_daily_so
    WHERE id = p_id AND status = 'submitted';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'COGS_OPERATION_NOT_FOUND';
    END IF;

    PERFORM public.cogs_assert_division_module(
      v_division,
      CASE lower(p_kind)
        WHEN 'production' THEN 'cogs_production'
        WHEN 'sale' THEN 'cogs_sales'
        ELSE 'cogs_daily_so'
      END
    );

    IF NOT public.has_perm('cogs.daily_so.edit') THEN
      RAISE EXCEPTION 'COGS_FEATURE_PERMISSION_DENIED' USING errcode = '42501';
    END IF;

    UPDATE public.cogs_daily_so
    SET status = 'void',
        voided_by = auth.uid(),
        voided_at = now(),
        notes = concat_ws(E'\\n', notes, nullif(trim(coalesce(p_reason, '')), ''))
    WHERE id = p_id AND status = 'submitted';

  ELSE
    RAISE EXCEPTION 'COGS_INVALID_OPERATION_KIND';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cogs_list_materials()
RETURNS TABLE (
  id uuid,
  name text,
  base_unit text,
  conversions jsonb,
  reference_price_per_base numeric,
  reference_price_amount numeric,
  reference_price_unit text,
  last_purchase_price_per_base numeric,
  active boolean,
  division_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR coalesce(public.app_role(), '') NOT IN ('dev', 'hr', 'div_admin', 'legacy_admin') THEN
    RAISE EXCEPTION 'COGS_ADMIN_ONLY' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.name,
    i.base_unit,
    i.conversions,
    i.reference_price_per_base,
    i.reference_price_amount,
    i.reference_price_unit,
    i.last_purchase_price_per_base,
    i.active,
    i.division_id
  FROM public.barapp_items i
  JOIN public.divisions d ON d.id = i.division_id
  WHERE d.has_cogs = true
    AND public.cogs_ops_can_access_division(i.division_id)
  ORDER BY i.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dev_set_account(
  p_user uuid,
  p_role text,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cur record;
  me uuid := auth.uid();
BEGIN
  IF NOT public.is_dev() THEN
    RAISE EXCEPTION 'Hanya developer';
  END IF;

  SELECT * INTO cur
  FROM public.user_profiles
  WHERE user_id = p_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun tidak ditemukan';
  END IF;

  IF cur.role = 'dev' THEN
    RAISE EXCEPTION 'Akun developer tidak bisa diubah dari sini';
  END IF;

  IF p_user = me AND p_active = false THEN
    RAISE EXCEPTION 'Tidak bisa menonaktifkan akun sendiri';
  END IF;

  IF p_role NOT IN ('hr', 'div_admin', 'legacy_admin') THEN
    RAISE EXCEPTION 'Role tidak valid';
  END IF;

  UPDATE public.user_profiles
  SET role = p_role,
      active = coalesce(p_active, true)
  WHERE user_id = p_user;

  -- HR scopes are now outlet-bound; preserve existing scopes. Legacy admin remains global/legacy.
  IF p_role = 'legacy_admin' THEN
    DELETE FROM public.user_scopes WHERE user_id = p_user;
  END IF;

  IF p_role = 'hr' THEN
    INSERT INTO public.user_permissions(user_id, permission)
    SELECT p_user, x
    FROM unnest(ARRAY[
      'payroll.view',
      'payroll.run',
      'payroll.finalize',
      'payroll.correct',
      'salary.manage',
      'allowance.manage',
      'kasbon.manage',
      'attendance.approve',
      'payslip.release'
    ]) x
    ON CONFLICT DO NOTHING;

  ELSIF p_role = 'div_admin' THEN
    DELETE FROM public.user_permissions
    WHERE user_id = p_user
      AND permission NOT IN ('inventory.view', 'inventory.manage');

  ELSE
    DELETE FROM public.user_permissions WHERE user_id = p_user;
  END IF;

  INSERT INTO public.audit_log(
    actor, actor_email, action, table_name, record_id, reason
  )
  VALUES (
    me,
    nullif(auth.jwt() ->> 'email', ''),
    'ACCOUNT_UPDATE',
    'user_profiles',
    p_user::text,
    'role=' || p_role || ' aktif=' || coalesce(p_active, true)::text
  );
END;
$function$;

-- Remove only the four policies whose predicates explicitly granted the role.
ALTER POLICY p_att_delete_feature ON public.attendance
  USING (
    has_perm('attendance.manage')
    AND (
      app_role() = 'dev'
      OR (
        app_role() = ANY (ARRAY['hr'::text, 'div_admin'::text])
        AND can_access_scope(outlet_id, division_id)
      )
      OR app_role() = 'legacy_admin'
    )
  );

ALTER POLICY p_div_sel ON public.divisions
  USING (
    app_role() = 'dev'
    OR app_role() = 'legacy_admin'
    OR (
      app_role() = ANY (ARRAY['hr'::text, 'div_admin'::text])
      AND can_access_scope(outlet_id, id)
    )
  );

ALTER POLICY p_att_select_feature ON public.attendance
  USING (
    (
      has_perm('attendance.view')
      OR has_perm('attendance.manage')
      OR (
        app_role() = ANY (ARRAY['dev'::text, 'hr'::text])
        AND has_perm('payroll.view')
      )
    )
    AND (
      app_role() = 'dev'
      OR app_role() = 'legacy_admin'
      OR (
        app_role() = ANY (ARRAY['hr'::text, 'div_admin'::text])
        AND can_access_scope(outlet_id, division_id)
      )
    )
  );

ALTER POLICY p_emp_select_feature ON public.employees
  USING (
    (
      has_perm('employees.view')
      OR has_perm('employees.manage')
      OR has_perm('attendance.view')
      OR has_perm('attendance.manage')
      OR (
        app_role() = ANY (ARRAY['dev'::text, 'hr'::text])
        AND has_perm('payroll.view')
      )
    )
    AND (
      app_role() = 'dev'
      OR app_role() = 'legacy_admin'
      OR (
        app_role() = ANY (ARRAY['hr'::text, 'div_admin'::text])
        AND can_access_scope(outlet_id, division_id)
      )
    )
  );

-- The old assignment RPC has no dependants and must no longer be callable.
DROP FUNCTION IF EXISTS public.dev_assign_report_viewer(text);

COMMIT;
