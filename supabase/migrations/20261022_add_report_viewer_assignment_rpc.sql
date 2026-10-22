create or replace function public.dev_assign_report_viewer(p_email text default 'crew@div.bar')
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $function$
declare
  v_email text := lower(trim(coalesce(p_email,'')));
  v_user_id uuid;
  v_role text;
  v_outlet public.outlets%rowtype;
begin
  if auth.uid() is null or not public.is_dev() then
    raise exception 'DEVELOPER_ONLY' using errcode='42501';
  end if;
  if v_email <> 'crew@div.bar' then
    raise exception 'REPORT_VIEWER_EMAIL_FIXED';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email)=v_email and u.deleted_at is null
  limit 1;
  if v_user_id is null then
    raise exception 'REPORT_VIEWER_AUTH_USER_NOT_FOUND';
  end if;

  select p.role into v_role
  from public.user_profiles p where p.user_id=v_user_id;
  if v_role='dev' then
    raise exception 'CANNOT_DOWNGRADE_DEVELOPER';
  end if;

  select * into v_outlet
  from public.outlets o
  where o.code='LJN' and o.active=true
  limit 1;
  if not found then raise exception 'LAZY_JENNIE_OUTLET_NOT_FOUND'; end if;

  insert into public.user_profiles(user_id,email,role,active)
  values(v_user_id,v_email,'report_viewer',true)
  on conflict(user_id) do update
    set email=excluded.email,role='report_viewer',active=true;

  delete from public.user_scopes where user_id=v_user_id;
  insert into public.user_scopes(user_id,outlet_id,division_id)
  values(v_user_id,v_outlet.id,null);

  delete from public.user_permissions where user_id=v_user_id;
  insert into public.user_permissions(user_id,permission)
  values
    (v_user_id,'attendance.view'),
    (v_user_id,'employees.view'),
    (v_user_id,'cogs.wip.view'),
    (v_user_id,'cogs.menu.view');

  insert into public.audit_log(actor,actor_email,action,table_name,record_id,reason)
  values(auth.uid(),nullif(auth.jwt()->>'email',''),'REPORT_VIEWER_ASSIGN','user_profiles',v_user_id::text,
    'Assigned read-only Rekap and Dashboard COGS access scoped to outlet LJN');

  return jsonb_build_object(
    'ok',true,'email',v_email,'role','report_viewer',
    'outlet',v_outlet.name,'permissions',jsonb_build_array('attendance.view','employees.view','cogs.wip.view','cogs.menu.view')
  );
end
$function$;

revoke all on function public.dev_assign_report_viewer(text) from public,anon;
grant execute on function public.dev_assign_report_viewer(text) to authenticated;
