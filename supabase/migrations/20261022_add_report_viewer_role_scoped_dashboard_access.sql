begin;

alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role = any (array['dev','hr','div_admin','legacy_admin','report_viewer']::text[]));

alter table public.user_permissions drop constraint if exists user_permissions_permission_check;
alter table public.user_permissions add constraint user_permissions_permission_check
  check (permission = any (array[
    'payroll.view','payroll.run','payroll.finalize','payroll.correct','salary.manage',
    'allowance.manage','kasbon.manage','attendance.approve','attendance.correct','payslip.release',
    'audit.view','division.manage','inventory.view','inventory.manage','attendance.view',
    'attendance.manage','employees.view','employees.manage','attendance.input',
    'cogs.production.view','cogs.production.manage','cogs.daily_so.difference',
    'cogs.daily_so.system','cogs.daily_so.edit','cogs.wip.view','cogs.wip.manage',
    'cogs.menu.view','cogs.menu.manage','cogs.sales.view','cogs.sales.manage',
    'inventory.inbound.view','inventory.inbound.manage',
    'employees.directory.view','attendance.report.view'
  ]::text[]));

create or replace function public.has_perm(p text)
returns boolean
language sql stable security definer set search_path=public
as $function$
 select case public.app_role()
   when 'dev' then true
   when 'hr' then exists(select 1 from public.user_permissions where user_id=auth.uid() and permission=p)
   when 'div_admin' then exists(select 1 from public.user_permissions where user_id=auth.uid() and permission=p)
   when 'legacy_admin' then exists(select 1 from public.user_permissions where user_id=auth.uid() and permission=p)
   when 'report_viewer' then exists(select 1 from public.user_permissions where user_id=auth.uid() and permission=p)
   else false
 end
$function$;

create or replace function public.can_access_scope(p_outlet uuid, p_division uuid)
returns boolean language sql stable security definer set search_path=public
as $function$
 select public.app_role() in ('dev','hr')
   or (public.app_role() in ('div_admin','report_viewer') and exists(
       select 1 from public.user_scopes s
       where s.user_id=auth.uid() and s.outlet_id=p_outlet
         and (s.division_id is null or s.division_id=p_division)))
$function$;

create or replace function public.cogs_ops_can_access_division(p_division_id uuid)
returns boolean
language sql stable security definer set search_path=public,auth
as $function$
 select auth.uid() is not null and exists (
   select 1 from public.divisions d
   where d.id=p_division_id and d.has_cogs=true
     and (
       coalesce(public.app_role(),'')='dev'
       or (
         coalesce(public.app_role(),'')='report_viewer'
         and (public.has_perm('cogs.wip.view') or public.has_perm('cogs.menu.view'))
         and public.can_access_scope(d.outlet_id,d.id)
       )
       or (
         (
           public.has_perm('cogs.daily_so.system')
           or public.has_perm('cogs.daily_so.difference')
           or public.has_perm('cogs.daily_so.edit')
           or public.has_perm('cogs.production.view')
           or public.has_perm('cogs.production.manage')
           or public.has_perm('cogs.wip.view')
           or public.has_perm('cogs.wip.manage')
           or public.has_perm('cogs.menu.view')
           or public.has_perm('cogs.menu.manage')
           or public.has_perm('cogs.sales.view')
           or public.has_perm('cogs.sales.manage')
         )
         and (
           coalesce(public.app_role(),'') in ('hr','legacy_admin')
           or (coalesce(public.app_role(),'')='div_admin' and public.can_access_scope(d.outlet_id,d.id))
         )
       )
     )
 );
$function$;

create or replace function public.cogs_list_materials()
returns table(
 id uuid,name text,base_unit text,conversions jsonb,
 reference_price_per_base numeric,reference_price_amount numeric,reference_price_unit text,
 last_purchase_price_per_base numeric,active boolean,division_id uuid
)
language plpgsql security definer set search_path=public
as $function$
begin
 if auth.uid() is null or not (
   coalesce(public.app_role(),'') in ('dev','hr','div_admin','legacy_admin')
   or (
     coalesce(public.app_role(),'')='report_viewer'
     and (public.has_perm('cogs.wip.view') or public.has_perm('cogs.menu.view'))
   )
 ) then
   raise exception 'COGS_ADMIN_ONLY' using errcode='42501';
 end if;
 return query
 select i.id,i.name,i.base_unit,i.conversions,i.reference_price_per_base,
   i.reference_price_amount,i.reference_price_unit,i.last_purchase_price_per_base,
   i.active,i.division_id
 from public.barapp_items i
 join public.divisions d on d.id=i.division_id
 where d.has_cogs=true and public.cogs_ops_can_access_division(i.division_id)
 order by i.name;
end;
$function$;

create or replace function public.dev_set_account(p_user uuid,p_role text,p_active boolean)
returns void
language plpgsql security definer set search_path=public
as $function$
declare cur record; me uuid:=auth.uid();
begin
 if not public.is_dev() then raise exception 'Hanya developer'; end if;
 select * into cur from public.user_profiles where user_id=p_user;
 if not found then raise exception 'Akun tidak ditemukan'; end if;
 if cur.role='dev' then raise exception 'Akun developer tidak bisa diubah dari sini'; end if;
 if p_user=me and p_active=false then raise exception 'Tidak bisa menonaktifkan akun sendiri'; end if;
 if p_role not in ('hr','div_admin','legacy_admin','report_viewer') then raise exception 'Role tidak valid'; end if;

 update public.user_profiles set role=p_role,active=coalesce(p_active,true) where user_id=p_user;

 if p_role in ('hr','legacy_admin') then
   delete from public.user_scopes where user_id=p_user;
 end if;

 -- Remove the limited role's old grants only when changing roles; toggling Active keeps custom grants.
 if cur.role='report_viewer' and cur.role is distinct from p_role then
   delete from public.user_permissions where user_id=p_user;
 end if;

 if p_role='hr' then
   insert into public.user_permissions(user_id,permission)
   select p_user,x from unnest(array[
     'payroll.view','payroll.run','payroll.finalize','salary.manage',
     'allowance.manage','kasbon.manage','attendance.approve','payslip.release'
   ]) x on conflict do nothing;
 elsif p_role='div_admin' then
   delete from public.user_permissions
   where user_id=p_user and permission not in ('inventory.view','inventory.manage');
 elsif p_role='report_viewer' then
   if cur.role is distinct from p_role then
     delete from public.user_permissions where user_id=p_user;
     insert into public.user_permissions(user_id,permission)
     values
       (p_user,'attendance.view'),
       (p_user,'employees.view'),
       (p_user,'cogs.wip.view'),
       (p_user,'cogs.menu.view');
   end if;
 else
   delete from public.user_permissions where user_id=p_user;
 end if;

 insert into public.audit_log(actor,actor_email,action,table_name,record_id,reason)
 values(me,nullif(auth.jwt()->>'email',''),'ACCOUNT_UPDATE','user_profiles',p_user::text,
  'role='||p_role||' aktif='||coalesce(p_active,true)::text);
end
$function$;

alter policy p_div_sel on public.divisions
  using (
    coalesce(public.app_role(),'') in ('dev','hr','legacy_admin')
    or (
      coalesce(public.app_role(),'') in ('div_admin','report_viewer')
      and public.can_access_scope(outlet_id,id)
    )
  );

drop policy if exists p_emp_select_feature on public.employees;
create policy p_emp_select_feature on public.employees
for select to authenticated
using (
  (
    public.has_perm('employees.view')
    or public.has_perm('employees.manage')
    or public.has_perm('attendance.view')
    or public.has_perm('attendance.manage')
    or (
      coalesce(public.app_role(),'') in ('dev','hr')
      and public.has_perm('payroll.view')
    )
  )
  and (
    coalesce(public.app_role(),'') in ('dev','hr','legacy_admin')
    or (
      coalesce(public.app_role(),'') in ('div_admin','report_viewer')
      and public.can_access_scope(outlet_id,division_id)
    )
  )
);

drop policy if exists p_att_select_feature on public.attendance;
create policy p_att_select_feature on public.attendance
for select to authenticated
using (
  (
    public.has_perm('attendance.view')
    or public.has_perm('attendance.manage')
    or (
      coalesce(public.app_role(),'') in ('dev','hr')
      and public.has_perm('payroll.view')
    )
  )
  and (
    coalesce(public.app_role(),'') in ('dev','hr','legacy_admin')
    or (
      coalesce(public.app_role(),'') in ('div_admin','report_viewer')
      and public.can_access_scope(outlet_id,division_id)
    )
  )
);

alter policy cogs_daily_so_select_admin on public.cogs_daily_so
  using (
    coalesce(public.app_role(),'') <> 'report_viewer'
    and public.cogs_ops_can_access_division(division_id)
    and public.division_module_enabled(division_id,'cogs_daily_so')
  );
alter policy cogs_daily_so_lines_select_admin on public.cogs_daily_so_lines
  using (
    coalesce(public.app_role(),'') <> 'report_viewer'
    and exists (
      select 1 from public.cogs_daily_so s
      where s.id=cogs_daily_so_lines.so_id
        and public.cogs_ops_can_access_division(s.division_id)
        and public.division_module_enabled(s.division_id,'cogs_daily_so')
    )
  );
alter policy cogs_menu_sales_select_admin on public.cogs_menu_sales
  using (
    coalesce(public.app_role(),'') <> 'report_viewer'
    and public.cogs_ops_can_access_division(division_id)
    and public.division_module_enabled(division_id,'cogs_sales')
  );
alter policy cogs_menu_sales_lines_select_admin on public.cogs_menu_sales_lines
  using (
    coalesce(public.app_role(),'') <> 'report_viewer'
    and exists (
      select 1 from public.cogs_menu_sales s
      where s.id=cogs_menu_sales_lines.sale_id
        and public.cogs_ops_can_access_division(s.division_id)
        and public.division_module_enabled(s.division_id,'cogs_sales')
    )
  );
alter policy cogs_production_select_admin on public.cogs_production_batches
  using (
    coalesce(public.app_role(),'') <> 'report_viewer'
    and public.cogs_ops_can_access_division(division_id)
    and public.division_module_enabled(division_id,'cogs_production')
  );
alter policy cogs_production_inputs_select_admin on public.cogs_production_inputs
  using (
    coalesce(public.app_role(),'') <> 'report_viewer'
    and exists (
      select 1 from public.cogs_production_batches b
      where b.id=cogs_production_inputs.batch_id
        and public.cogs_ops_can_access_division(b.division_id)
        and public.division_module_enabled(b.division_id,'cogs_production')
    )
  );

commit;
