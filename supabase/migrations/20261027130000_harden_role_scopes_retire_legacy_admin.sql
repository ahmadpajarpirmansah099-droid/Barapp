-- Barapp role-scope hardening.
-- Safe by construction: validate current active assignments before changing access rules.
-- This migration does not delete or rewrite employee, attendance, or operational data.

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE role='legacy_admin' AND active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Access-scope migration paused: active legacy_admin accounts need manual role/scope migration first.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.active IS TRUE AND up.role='hr'
      AND (
        (SELECT COUNT(DISTINCT s.outlet_id) FROM public.user_scopes s WHERE s.user_id=up.user_id) <> 1
        OR NOT EXISTS (
          SELECT 1 FROM public.user_scopes s
          WHERE s.user_id=up.user_id AND s.division_id IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'Access-scope migration paused: every active HR account must have one outlet-wide scope.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.active IS TRUE AND up.role='div_admin'
      AND (
        (SELECT COUNT(DISTINCT s.outlet_id) FROM public.user_scopes s WHERE s.user_id=up.user_id) <> 1
        OR NOT EXISTS (
          SELECT 1 FROM public.user_scopes s
          WHERE s.user_id=up.user_id AND s.division_id IS NOT NULL
        )
        OR EXISTS (
          SELECT 1 FROM public.user_scopes s
          WHERE s.user_id=up.user_id AND s.division_id IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'Access-scope migration paused: every active Admin Divisi account must have division-specific scopes in one outlet.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE role='report_viewer' AND active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Access-scope migration paused: move active report_viewer accounts to HR/Admin Divisi scopes and feature permissions first.';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.can_access_scope(p_outlet uuid, p_division uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.app_role()='dev' THEN true
    WHEN public.app_role()='hr' THEN
      p_outlet IS NOT NULL
      AND (SELECT COUNT(DISTINCT s.outlet_id) FROM public.user_scopes s WHERE s.user_id=auth.uid())=1
      AND EXISTS (
        SELECT 1 FROM public.user_scopes s
        WHERE s.user_id=auth.uid() AND s.outlet_id=p_outlet AND s.division_id IS NULL
      )
    WHEN public.app_role()='div_admin' THEN
      p_outlet IS NOT NULL AND p_division IS NOT NULL
      AND (SELECT COUNT(DISTINCT s.outlet_id) FROM public.user_scopes s WHERE s.user_id=auth.uid())=1
      AND EXISTS (
        SELECT 1 FROM public.user_scopes s
        WHERE s.user_id=auth.uid() AND s.outlet_id=p_outlet
          AND s.division_id=p_division AND s.division_id IS NOT NULL
      )
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION public.can_access_outlet(p_outlet uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.app_role()='dev' THEN true
    WHEN public.app_role()='hr' THEN
      p_outlet IS NOT NULL
      AND (SELECT COUNT(DISTINCT s.outlet_id) FROM public.user_scopes s WHERE s.user_id=auth.uid())=1
      AND EXISTS (
        SELECT 1 FROM public.user_scopes s
        WHERE s.user_id=auth.uid() AND s.outlet_id=p_outlet AND s.division_id IS NULL
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
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.divisions d
    WHERE d.id=p_division_id AND (
      public.app_role()='dev'
      OR (public.app_role() IN ('hr','div_admin')
          AND public.can_access_scope(d.outlet_id,d.id))
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.has_perm(p text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.app_role()='dev' THEN true
    WHEN public.app_role() IN ('hr','div_admin') THEN
      EXISTS (
        SELECT 1 FROM public.user_permissions
        WHERE user_id=auth.uid() AND permission=p
      )
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION public.cogs_ops_can_access_division(p_division_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.divisions d
    WHERE d.id=p_division_id AND d.has_cogs=true AND (
      public.app_role()='dev'
      OR (
        public.app_role() IN ('hr','div_admin')
        AND public.can_access_scope(d.outlet_id,d.id)
        AND (
          public.has_perm('cogs.daily_so.system') OR public.has_perm('cogs.daily_so.difference')
          OR public.has_perm('cogs.daily_so.edit') OR public.has_perm('cogs.production.view')
          OR public.has_perm('cogs.production.manage') OR public.has_perm('cogs.wip.view')
          OR public.has_perm('cogs.wip.manage') OR public.has_perm('cogs.menu.view')
          OR public.has_perm('cogs.menu.manage') OR public.has_perm('cogs.sales.view')
          OR public.has_perm('cogs.sales.manage')
        )
      )

    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.ws_can(d uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.app_role()='dev'
    OR (
      public.app_role() IN ('hr','div_admin')
      AND EXISTS (
        SELECT 1 FROM public.divisions x
        WHERE x.id=d AND public.can_access_scope(x.outlet_id,x.id)
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_can_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT coalesce(
    public.app_role()='dev'
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles up
      JOIN public.user_permissions p
        ON p.user_id=up.user_id AND p.permission='feature.guest_arrival.access'
      WHERE up.user_id=auth.uid()
        AND up.active
        AND lower(up.email)=lower(coalesce(auth.jwt()->>'email',''))
        AND (
          SELECT COUNT(DISTINCT s2.outlet_id)
          FROM public.user_scopes s2
          JOIN public.outlets o2 ON o2.id=s2.outlet_id AND o2.active
          WHERE s2.user_id=up.user_id
        )=1
        AND EXISTS (
          SELECT 1 FROM public.user_scopes s
          JOIN public.outlets o ON o.id=s.outlet_id AND o.active
          WHERE s.user_id=up.user_id
        )
    ),
    false
  )
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_current_outlet()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE v_outlet uuid;
BEGIN
  IF public.app_role()='dev' OR NOT public.guest_arrival_can_access() THEN RETURN NULL; END IF;
  SELECT CASE WHEN COUNT(DISTINCT s.outlet_id)=1 THEN MIN(s.outlet_id::text)::uuid ELSE NULL END
    INTO v_outlet
  FROM public.user_scopes s
  JOIN public.outlets o ON o.id=s.outlet_id AND o.active
  WHERE s.user_id=auth.uid();
  RETURN v_outlet;
END
$function$;

CREATE OR REPLACE FUNCTION public.dev_set_division_admin(p_email text, p_division uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE u uuid; d public.divisions; cur text;
BEGIN
  IF NOT public.is_dev() THEN
    RAISE EXCEPTION 'Hanya developer yang bisa mengatur role dan scope admin divisi' USING errcode='42501';
  END IF;
  SELECT id INTO u FROM auth.users WHERE lower(email)=lower(btrim(p_email));
  IF u IS NULL THEN RAISE EXCEPTION 'Akun belum ada di Authentication. Buat dulu di Supabase, lalu coba lagi.'; END IF;
  SELECT role INTO cur FROM public.user_profiles WHERE user_id=u;
  IF cur IN ('dev','hr') THEN
    RAISE EXCEPTION 'Akun ini sudah berperan sebagai %, tidak bisa dijadikan admin divisi.',cur;
  END IF;
  SELECT * INTO d FROM public.divisions WHERE id=p_division;
  IF NOT FOUND THEN RAISE EXCEPTION 'Divisi tidak ditemukan'; END IF;
  INSERT INTO public.user_profiles(user_id,email,role,active)
    VALUES(u,lower(btrim(p_email)),'div_admin',true)
    ON CONFLICT (user_id) DO UPDATE SET role='div_admin',active=true,email=excluded.email;
  DELETE FROM public.user_scopes WHERE user_id=u;
  INSERT INTO public.user_scopes(user_id,outlet_id,division_id) VALUES(u,d.outlet_id,d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.dev_assign_report_viewer(p_email text DEFAULT 'crew@div.bar'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_dev() THEN
    RAISE EXCEPTION 'DEVELOPER_ONLY' USING errcode='42501';
  END IF;
  RAISE EXCEPTION 'REPORT_VIEWER_ROLE_RETIRED: use HR/Admin Divisi scope with explicit feature permissions.';
END
$function$;

CREATE OR REPLACE FUNCTION public.dev_set_account(p_user uuid, p_role text, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE cur record; me uuid:=auth.uid();
BEGIN
  IF NOT public.is_dev() THEN RAISE EXCEPTION 'Hanya developer'; END IF;
  SELECT * INTO cur FROM public.user_profiles WHERE user_id=p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Akun tidak ditemukan'; END IF;
  IF cur.role='dev' THEN RAISE EXCEPTION 'Akun developer tidak bisa diubah dari sini'; END IF;
  IF p_user=me AND p_active=false THEN RAISE EXCEPTION 'Tidak bisa menonaktifkan akun sendiri'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('hr','div_admin') THEN
    RAISE EXCEPTION 'Role tidak valid';
  END IF;

  IF coalesce(p_active,true) THEN
    IF p_role='hr' AND (
      (SELECT COUNT(DISTINCT s.outlet_id) FROM public.user_scopes s WHERE s.user_id=p_user) <> 1
      OR NOT EXISTS (SELECT 1 FROM public.user_scopes s WHERE s.user_id=p_user AND s.division_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'HR harus memiliki scope outlet yang valid sebelum akun diaktifkan.';
    END IF;

    IF p_role='div_admin' AND (
      (SELECT COUNT(DISTINCT s.outlet_id) FROM public.user_scopes s WHERE s.user_id=p_user) <> 1
      OR NOT EXISTS (SELECT 1 FROM public.user_scopes s WHERE s.user_id=p_user AND s.division_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.user_scopes s WHERE s.user_id=p_user AND s.division_id IS NULL)
      OR EXISTS (
        SELECT 1 FROM public.user_scopes s
        LEFT JOIN public.divisions d ON d.id=s.division_id
        WHERE s.user_id=p_user AND s.division_id IS NOT NULL
          AND (d.id IS NULL OR d.outlet_id<>s.outlet_id)
      )
    ) THEN
      RAISE EXCEPTION 'Admin Divisi harus memiliki scope divisi valid dalam satu outlet. Atur melalui Developer > Divisi & Admin.';
    END IF;
  END IF;

  UPDATE public.user_profiles
    SET role=p_role,active=coalesce(p_active,true)
    WHERE user_id=p_user;

  IF cur.role='report_viewer' AND cur.role IS DISTINCT FROM p_role THEN
    DELETE FROM public.user_permissions WHERE user_id=p_user;
  END IF;

  IF p_role='hr' THEN
    INSERT INTO public.user_permissions(user_id,permission)
    SELECT p_user,x FROM unnest(ARRAY[
      'payroll.view','payroll.run','payroll.finalize','payroll.correct','salary.manage',
      'allowance.manage','kasbon.manage','attendance.approve','payslip.release'
    ]) x ON CONFLICT DO NOTHING;
  ELSIF p_role='div_admin' THEN
    DELETE FROM public.user_permissions
    WHERE user_id=p_user AND permission NOT IN ('inventory.view','inventory.manage');
  END IF;

  INSERT INTO public.audit_log(actor,actor_email,action,table_name,record_id,reason)
  VALUES(me,nullif(auth.jwt()->>'email',''),'ACCOUNT_UPDATE','user_profiles',p_user::text,
    'role='||p_role||' aktif='||coalesce(p_active,true)::text);
END
$function$;

CREATE OR REPLACE FUNCTION public.cogs_assert_ops_division(p_division_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE v_role text := coalesce(public.app_role(),'');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'COGS_ADMIN_ONLY' USING errcode='42501';
  END IF;
  IF v_role NOT IN ('dev','hr','div_admin') THEN
    RAISE EXCEPTION 'COGS_ADMIN_ONLY' USING errcode='42501';
  END IF;
  IF NOT public.cogs_ops_can_access_division(p_division_id) THEN
    RAISE EXCEPTION 'COGS_DIVISION_FORBIDDEN' USING errcode='42501';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.cogs_cancel_operation(p_kind text, p_id uuid, p_reason text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_division uuid;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.app_role(),'') NOT IN ('dev','hr','div_admin') THEN
    RAISE EXCEPTION 'COGS_ADMIN_ONLY' USING errcode='42501';
  END IF;
  IF lower(p_kind)='production' THEN
    SELECT division_id INTO v_division FROM public.cogs_production_batches WHERE id=p_id AND status='posted';
    IF NOT FOUND THEN RAISE EXCEPTION 'COGS_OPERATION_NOT_FOUND'; END IF;
    PERFORM public.cogs_assert_division_module(v_division, 'cogs_production');
    IF NOT public.has_perm('cogs.production.manage') THEN RAISE EXCEPTION 'COGS_FEATURE_PERMISSION_DENIED' USING errcode='42501'; END IF;
    UPDATE public.cogs_production_batches
      SET status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),
          notes=concat_ws(E'\n',notes,nullif(trim(coalesce(p_reason,'')),''))
      WHERE id=p_id AND status='posted';
  ELSIF lower(p_kind)='sale' THEN
    SELECT division_id INTO v_division FROM public.cogs_menu_sales WHERE id=p_id AND status='posted';
    IF NOT FOUND THEN RAISE EXCEPTION 'COGS_OPERATION_NOT_FOUND'; END IF;
    PERFORM public.cogs_assert_division_module(v_division, 'cogs_sales');
    IF NOT public.has_perm('cogs.sales.manage') THEN RAISE EXCEPTION 'COGS_FEATURE_PERMISSION_DENIED' USING errcode='42501'; END IF;
    UPDATE public.cogs_menu_sales
      SET status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),
          notes=concat_ws(E'\n',notes,nullif(trim(coalesce(p_reason,'')),''))
      WHERE id=p_id AND status='posted';
  ELSIF lower(p_kind)='daily_so' THEN
    SELECT division_id INTO v_division FROM public.cogs_daily_so WHERE id=p_id AND status='submitted';
    IF NOT FOUND THEN RAISE EXCEPTION 'COGS_OPERATION_NOT_FOUND'; END IF;
    PERFORM public.cogs_assert_division_module(v_division, 'cogs_daily_so');
    IF NOT public.has_perm('cogs.daily_so.edit') THEN RAISE EXCEPTION 'COGS_FEATURE_PERMISSION_DENIED' USING errcode='42501'; END IF;
    UPDATE public.cogs_daily_so
      SET status='void',voided_by=auth.uid(),voided_at=now(),
          notes=concat_ws(E'\n',notes,nullif(trim(coalesce(p_reason,'')),''))
      WHERE id=p_id AND status='submitted';
  ELSE
    RAISE EXCEPTION 'COGS_INVALID_OPERATION_KIND';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.cogs_list_materials()
RETURNS TABLE(id uuid, name text, base_unit text, conversions jsonb, reference_price_per_base numeric, reference_price_amount numeric, reference_price_unit text, last_purchase_price_per_base numeric, active boolean, division_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.app_role(),'') NOT IN ('dev','hr','div_admin') THEN
    RAISE EXCEPTION 'COGS_ADMIN_ONLY' USING errcode='42501';
  END IF;
  RETURN QUERY
  SELECT i.id,i.name,i.base_unit,i.conversions,i.reference_price_per_base,
    i.reference_price_amount,i.reference_price_unit,i.last_purchase_price_per_base,
    i.active,i.division_id
  FROM public.barapp_items i
  JOIN public.divisions d ON d.id=i.division_id
  WHERE d.has_cogs=true AND public.cogs_ops_can_access_division(i.division_id)
  ORDER BY i.name;
END
$function$;

CREATE OR REPLACE FUNCTION public.staff_set_pin(p_employee text, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE e record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Harus login'; END IF;
  IF NOT public.has_perm('employees.manage') THEN RAISE EXCEPTION 'Tidak berwenang mengatur PIN karyawan' USING errcode='42501'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN RAISE EXCEPTION 'PIN harus 4 sampai 6 angka'; END IF;
  SELECT * INTO e FROM public.employees WHERE id::text=p_employee FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Karyawan tidak ditemukan'; END IF;
  IF NOT (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(e.outlet_id,e.division_id))
  ) THEN RAISE EXCEPTION 'Tidak berwenang mengatur PIN' USING errcode='42501'; END IF;
  UPDATE public.employees SET pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)),
    pin_fail=0,pin_locked_until=NULL,pin_set_at=now() WHERE id=e.id;
  DELETE FROM public.staff_sessions WHERE employee_id=e.id::text;
  INSERT INTO public.audit_log(actor,actor_email,action,table_name,record_id,reason)
  VALUES(auth.uid(),nullif(auth.jwt()->>'email',''),'STAFF_PIN_SET','employees',e.id::text,'PIN diatur ulang (nilai PIN tidak dicatat)');
END
$function$;

DROP POLICY IF EXISTS p_att_delete_feature ON public.attendance;
CREATE POLICY p_att_delete_feature ON public.attendance FOR DELETE TO authenticated
USING (
  public.has_perm('attendance.manage')
  AND (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,division_id))
  )
);

DROP POLICY IF EXISTS p_att_insert_feature ON public.attendance;
CREATE POLICY p_att_insert_feature ON public.attendance FOR INSERT TO authenticated
WITH CHECK (
  public.has_perm('attendance.manage')
  AND (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,division_id))
  )
);

DROP POLICY IF EXISTS p_att_select_feature ON public.attendance;
CREATE POLICY p_att_select_feature ON public.attendance FOR SELECT TO authenticated
USING (
  (
    public.has_perm('attendance.view') OR public.has_perm('attendance.manage')
    OR (public.app_role() IN ('dev','hr') AND public.has_perm('payroll.view'))
  )
  AND (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,division_id))
  )
);

DROP POLICY IF EXISTS p_att_update_feature ON public.attendance;
CREATE POLICY p_att_update_feature ON public.attendance FOR UPDATE TO authenticated
USING (
  public.has_perm('attendance.manage')
  AND (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,division_id))
  )
)
WITH CHECK (
  public.has_perm('attendance.manage')
  AND (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,division_id))
  )
);

DROP POLICY IF EXISTS p_div_sel ON public.divisions;
CREATE POLICY p_div_sel ON public.divisions FOR SELECT TO authenticated
USING (
  public.app_role()='dev'
  OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,id))
);

DROP POLICY IF EXISTS p_emp_delete_feature ON public.employees;
CREATE POLICY p_emp_delete_feature ON public.employees FOR DELETE TO authenticated
USING (
  public.has_perm('employees.manage')
  AND (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,division_id))
  )
);

DROP POLICY IF EXISTS p_emp_insert_feature ON public.employees;
CREATE POLICY p_emp_insert_feature ON public.employees FOR INSERT TO authenticated
WITH CHECK (
  public.has_perm('employees.manage')
  AND (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,division_id))
  )
);

DROP POLICY IF EXISTS p_emp_select_feature ON public.employees;
CREATE POLICY p_emp_select_feature ON public.employees FOR SELECT TO authenticated
USING (
  (
    public.has_perm('employees.view') OR public.has_perm('employees.manage')
    OR public.has_perm('attendance.view') OR public.has_perm('attendance.manage')
    OR (public.app_role() IN ('dev','hr') AND public.has_perm('payroll.view'))
  )
  AND (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,division_id))
  )
);

DROP POLICY IF EXISTS p_emp_update_feature ON public.employees;
CREATE POLICY p_emp_update_feature ON public.employees FOR UPDATE TO authenticated
USING (
  public.has_perm('employees.manage')
  AND (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,division_id))
  )
)
WITH CHECK (
  public.has_perm('employees.manage')
  AND (
    public.app_role()='dev'
    OR (public.app_role() IN ('hr','div_admin') AND public.can_access_scope(outlet_id,division_id))
  )
);

DROP POLICY IF EXISTS p_pp_w ON public.payroll_periods;
CREATE POLICY p_pp_w ON public.payroll_periods FOR ALL TO authenticated
USING (
  public.app_role()='hr'
  AND public.has_perm('payroll.view')
  AND outlet_id IS NOT NULL
  AND public.can_access_outlet(outlet_id)
)
WITH CHECK (
  public.app_role()='hr'
  AND public.has_perm('payroll.view')
  AND outlet_id IS NOT NULL
  AND public.can_access_outlet(outlet_id)
);
