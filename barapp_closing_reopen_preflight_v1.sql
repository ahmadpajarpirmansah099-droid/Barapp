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
trigger_requirements(table_name, trigger_name) as (
  values
    ('barapp_stock_in','trg_closing_dirty_stock_in'),
    ('barapp_stock_out','trg_closing_dirty_stock_out'),
    ('barapp_stock_returns','trg_closing_dirty_stock_returns'),
    ('barapp_supplies_so','trg_closing_dirty_supplies_so'),
    ('barapp_supplies_so_lines','trg_closing_dirty_supplies_lines'),
    ('cogs_daily_so','trg_closing_dirty_daily_so'),
    ('cogs_daily_so_lines','trg_closing_dirty_daily_so_lines'),
    ('cogs_menu_sales','trg_closing_dirty_sales'),
    ('cogs_menu_sales_lines','trg_closing_dirty_sales_lines'),
    ('cogs_production_batches','trg_closing_dirty_production'),
    ('cogs_production_inputs','trg_closing_dirty_production_inputs')
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

  select 'trigger:' || t.trigger_name,
         case when count(distinct i.event_manipulation)=3 then 'PASS' else 'WARN' end,
         'found_operations=' || coalesce(string_agg(distinct i.event_manipulation, ',' order by i.event_manipulation), 'none')
           || '; expected=INSERT,UPDATE,DELETE'
  from trigger_requirements t
  left join information_schema.triggers i
    on i.event_object_schema='public'
   and i.event_object_table=t.table_name
   and i.trigger_name=t.trigger_name
  group by t.table_name,t.trigger_name

  union all

  select 'data:approval_marker_consistency',
         case when
           count(*) filter (where status='approved' and (approved_at is null or approved_by is null))=0
           and count(*) filter (
             where status not in ('approved','needs_reconciliation')
               and (approved_at is not null or approved_by is not null)
           )=0
           then 'PASS' else 'WARN' end,
         'approved_missing_marker=' ||
           count(*) filter (where status='approved' and (approved_at is null or approved_by is null)) ||
         '; unexpected_nonapproved_has_marker=' ||
           count(*) filter (
             where status not in ('approved','needs_reconciliation')
               and (approved_at is not null or approved_by is not null)
           ) ||
         '; needs_reconciliation_with_prior_approval_marker=' ||
           count(*) filter (
             where status='needs_reconciliation'
               and (approved_at is not null or approved_by is not null)
           )
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
