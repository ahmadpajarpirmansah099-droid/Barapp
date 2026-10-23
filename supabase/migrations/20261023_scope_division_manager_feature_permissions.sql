-- Limit division-manager account and feature-permission administration to the caller's own division.
-- Developer access remains cross-division. Keep validation in the database, not only in UI filtering.

CREATE OR REPLACE FUNCTION public.division_manager_list_accounts()
 RETURNS TABLE(user_id uuid, email text, role text, active boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
 if auth.uid() is null
    or coalesce(public.app_role(),'') <> 'div_admin'
    or not exists(
      select 1 from public.user_permissions up
      where up.user_id=auth.uid() and up.permission='division.manage'
    ) then
  raise exception 'DIVISION_MANAGER_ONLY' using errcode='42501';
 end if;

 return query
 select p.user_id,p.email,p.role,p.active
 from public.user_profiles p
 where p.role='div_admin' and p.active=true and p.user_id<>auth.uid()
   and exists (
     select 1
     from public.user_scopes caller_scope
     join public.user_scopes target_scope
       on target_scope.outlet_id=caller_scope.outlet_id
      and target_scope.division_id=caller_scope.division_id
     where caller_scope.user_id=auth.uid()
       and target_scope.user_id=p.user_id
       and caller_scope.division_id is not null
   )
 order by lower(coalesce(p.email,''));
end
$function$;

CREATE OR REPLACE FUNCTION public.division_manager_list_feature_perms()
 RETURNS TABLE(user_id uuid, permission text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
 if auth.uid() is null
    or coalesce(public.app_role(),'') <> 'div_admin'
    or not exists(
      select 1 from public.user_permissions up
      where up.user_id=auth.uid() and up.permission='division.manage'
    ) then
  raise exception 'DIVISION_MANAGER_ONLY' using errcode='42501';
 end if;

 return query
 select up.user_id,up.permission
 from public.user_permissions up
 join public.user_profiles p on p.user_id=up.user_id
 where p.role='div_admin' and p.active=true and p.user_id<>auth.uid()
   and exists (
     select 1
     from public.user_scopes caller_scope
     join public.user_scopes target_scope
       on target_scope.outlet_id=caller_scope.outlet_id
      and target_scope.division_id=caller_scope.division_id
     where caller_scope.user_id=auth.uid()
       and target_scope.user_id=p.user_id
       and caller_scope.division_id is not null
   );
end
$function$;

CREATE OR REPLACE FUNCTION public.dev_set_feature_perms_bulk(p_user uuid, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  target_role text;
  c jsonb;
  perm text;
  enabled boolean;
  changed_count integer := 0;
  touched integer;
  allowed_permissions text[] := array[
    'attendance.input','attendance.view','attendance.manage','attendance.approve','attendance.correct','employees.view','employees.manage',
    'employees.directory.view','attendance.report.view',
    'payroll.view','payroll.run','payroll.finalize','payroll.correct','salary.manage','allowance.manage','kasbon.manage','division.manage','inventory.view','inventory.manage',
    'cogs.production.view','cogs.production.manage','cogs.daily_so.difference','cogs.daily_so.system',
    'cogs.daily_so.edit','cogs.wip.view','cogs.wip.manage','cogs.menu.view','cogs.menu.manage',
    'cogs.sales.view','cogs.sales.manage','inventory.inbound.view','inventory.inbound.manage'
  ];
begin
  if not public.is_dev() and not (
    coalesce(public.app_role(),'')='div_admin'
    and exists(
      select 1 from public.user_permissions caller_perm
      where caller_perm.user_id=auth.uid() and caller_perm.permission='division.manage'
    )
  ) then
    raise exception 'DEVELOPER_OR_DIVISION_MANAGER_ONLY' using errcode='42501';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'INVALID_PERMISSION_CHANGES';
  end if;

  select role into target_role
  from public.user_profiles where user_id=p_user and active=true;
  if target_role is null then raise exception 'ACTIVE_ACCOUNT_NOT_FOUND'; end if;
  if target_role='dev' then raise exception 'DEVELOPER_PERMISSIONS_ARE_FIXED'; end if;

  if not public.is_dev() then
    if target_role<>'div_admin' or p_user=auth.uid() then
      raise exception 'DIVISION_MANAGER_CAN_ONLY_MANAGE_OTHER_ADMINS' using errcode='42501';
    end if;
    if not exists (
      select 1
      from public.user_scopes caller_scope
      join public.user_scopes target_scope
        on target_scope.outlet_id=caller_scope.outlet_id
       and target_scope.division_id=caller_scope.division_id
      where caller_scope.user_id=auth.uid()
        and target_scope.user_id=p_user
        and caller_scope.division_id is not null
    ) then
      raise exception 'DIVISION_MANAGER_TARGET_OUT_OF_SCOPE' using errcode='42501';
    end if;
  end if;

  for c in select value from jsonb_array_elements(p_changes)
  loop
    perm := c->>'permission';
    if perm is null or not (perm=any(allowed_permissions)) then
      raise exception 'INVALID_PERMISSION';
    end if;
    if jsonb_typeof(c->'enabled') <> 'boolean' then
      raise exception 'INVALID_PERMISSION_CHANGES';
    end if;
  end loop;

  if (select count(*) from jsonb_array_elements(p_changes)) <>
     (select count(distinct value->>'permission') from jsonb_array_elements(p_changes)) then
    raise exception 'DUPLICATE_PERMISSION_CHANGE';
  end if;

  for c in select value from jsonb_array_elements(p_changes)
  loop
    perm := c->>'permission';
    enabled := (c->>'enabled')::boolean;
    if enabled then
      insert into public.user_permissions(user_id,permission)
      values(p_user,perm) on conflict (user_id,permission) do nothing;
      get diagnostics touched = row_count;
    else
      delete from public.user_permissions where user_id=p_user and permission=perm;
      get diagnostics touched = row_count;
    end if;
    changed_count := changed_count + touched;
  end loop;

  insert into public.audit_log(actor,actor_email,action,table_name,record_id,old_data,new_data,reason)
  values(
    auth.uid(),nullif(auth.jwt()->>'email',''),'FEATURE_PERMISSION_BULK_UPDATE',
    'user_permissions',p_user::text,null,
    jsonb_build_object('submitted_changes',p_changes,'changed_rows',changed_count),
    'Feature permissions saved in one transaction'
  );
end
$function$;
