-- BarApp Closing Reopen V1 preflight (READ ONLY)
-- Run this in Supabase SQL Editor before considering the migration.
-- This script does not create, update, or delete records or schema objects.
-- It is intended to check prerequisites and report current state only.

with table_requirements(table_name) as (
  values
    ('barapp_closing_periods'),
    ('barapp_closing_modules'),
    ('audit_log'),
    ('divisions')
),
column_requirements(table_name, column_name) as (
  values
    ('barapp_closing_periods','id'),
    ('barapp_closing_periods','division_id'),
    ('barapp_closing_periods','closing_date'),
    ('barapp_closing_periods','status'),
    ('barapp_closing_periods','approved_by'),
    ('barapp_closing_periods','approved_at'),
    ('barapp_closing_periods','summary'),
    ('barapp_closing_modules','closing_id'),
    ('barapp_closing_modules','module_key'),
    ('barapp_closing_modules','status'),
    ('barapp_closing_modules','snapshot'),
    ('barapp_closing_modules','confirmed_by'),
    ('barapp_closing_modules','confirmed_at'),
    ('audit_log','at'),
    ('audit_log','actor'),
    ('audit_log','actor_email'),
    ('audit_log','action'),
    ('audit_log','table_name'),
    ('audit_log','record_id'),
    ('audit_log','old_data'),
    ('audit_log','new_data'),
    ('audit_log','reason')
),
function_requirements(function_signature) as (
  values
    ('public.barapp_closing_assert_access()'),
    ('public.barapp_closing_can_access_division(uuid)'),
    ('public.barapp_closing_module_snapshot(uuid,date,text)'),
    ('public.barapp_closing_approve(uuid,date,text)'),
    ('public.barapp_closing_confirm_module(uuid,date,text,boolean,text)')
),
checks as (
  select 'table:' || t.table_name as check_name,
         case when to_regclass('public.' || t.table_name) is not null then 'PASS' else 'FAIL' end as result,
         case when to_regclass('public.' || t.table_name) is not null
              then 'Required table exists'
              else 'Required table is missing' end as detail
  from table_requirements t

  union all

  select 'column:' || c.table_name || '.' || c.column_name,
         case when exists (
           select 1 from information_schema.columns i
           where i.table_schema='public'
             and i.table_name=c.table_name
             and i.column_name=c.column_name
         ) then 'PASS' else 'FAIL' end,
         case when exists (
           select 1 from information_schema.columns i
           where i.table_schema='public'
             and i.table_name=c.table_name
             and i.column_name=c.column_name
         ) then 'Required column exists' else 'Required column is missing' end
  from column_requirements c

  union all

  select 'function:' || f.function_signature,
         case when to_regprocedure(f.function_signature) is not null then 'PASS' else 'FAIL' end,
         case when to_regprocedure(f.function_signature) is not null
              then 'Required function/signature exists'
              else 'Required function/signature is missing' end
  from function_requirements f

  union all

  select 'trigger:trg_closing_dirty_daily_so_lines_update',
         case when exists (
           select 1 from information_schema.triggers t
           where t.event_object_schema='public'
             and t.event_object_table='cogs_daily_so_lines'
             and t.trigger_name='trg_closing_dirty_daily_so_lines'
             and t.event_manipulation='UPDATE'
         ) then 'PASS' else 'WARN' end,
         case when exists (
           select 1 from information_schema.triggers t
           where t.event_object_schema='public'
             and t.event_object_table='cogs_daily_so_lines'
             and t.trigger_name='trg_closing_dirty_daily_so_lines'
             and t.event_manipulation='UPDATE'
         ) then 'Daily SO line update reconciliation trigger found'
         else 'Review whether the Daily SO line reconciliation trigger is installed' end

  union all

  select 'data:approval_marker_consistency',
         case when
           count(*) filter (where status='approved' and (approved_at is null or approved_by is null))=0
           and count(*) filter (where status<>'approved' and (approved_at is not null or approved_by is not null))=0
           then 'PASS' else 'WARN' end,
         'approved_missing_marker=' ||
           count(*) filter (where status='approved' and (approved_at is null or approved_by is null)) ||
         '; nonapproved_has_marker=' ||
           count(*) filter (where status<>'approved' and (approved_at is not null or approved_by is not null))
  from public.barapp_closing_periods

  union all

  select 'migration:barapp_closing_reopen',
         case when p.oid is null then 'INFO' else
           case when p.prosecdef
             and pg_get_functiondef(p.oid) like '%set search_path to ''pg_catalog'', ''pg_temp''%'
             and has_function_privilege('authenticated',p.oid,'EXECUTE')
             and not has_function_privilege('anon',p.oid,'EXECUTE')
             then 'PASS' else 'FAIL' end
         end,
         case when p.oid is null
           then 'RPC is not installed; migration has not been applied to this database'
           else 'RPC installed; security-definer, locked search_path, authenticated grant, and anon denial checked'
         end
  from (select to_regprocedure('public.barapp_closing_reopen(uuid,date,text)') as oid) r
  left join pg_proc p on p.oid=r.oid
)
select check_name, result, detail
from checks
order by case result when 'FAIL' then 1 when 'WARN' then 2 when 'INFO' then 3 else 4 end, check_name;
