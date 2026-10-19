-- BarApp security and operational verification V1 (READ-ONLY)
-- Run against a VERIFIED STAGING project after applying barapp_security_hardening_v1.sql.
-- Every section is SELECT-only. This script does not change schema, grants, or data.
-- Review the listed anon-executable SECURITY DEFINER routines individually; the staff
-- PIN/token RPCs may intentionally need anon access, so this script does not revoke them.

-- 1) SECURITY DEFINER search_path hardening. Expected after migration:
-- total_functions = hardened_functions; missing_fixed_path = 0.
with sd as (
  select p.oid,
    p.oid::regprocedure::text as signature,
    (
      select substring(cfg from length('search_path=') + 1)
      from unnest(coalesce(p.proconfig, array[]::text[])) cfg
      where cfg like 'search_path=%'
      limit 1
    ) as function_path
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
)
select
  count(*) as total_functions,
  count(*) filter (
    where function_path is not null
      and split_part(btrim(function_path), ',', 1) = 'pg_catalog'
      and right(btrim(function_path), 7) = 'pg_temp'
  ) as hardened_functions,
  count(*) filter (where function_path is null) as missing_fixed_path,
  count(*) filter (
    where function_path is not null and (
      split_part(btrim(function_path), ',', 1) <> 'pg_catalog'
      or right(btrim(function_path), 7) <> 'pg_temp'
    )
  ) as functions_needing_review
from sd;

-- 2) Inventory anon-executable SECURITY DEFINER routines for manual review.
-- Do not revoke staff PIN/token handlers blindly; their anonymous access can be intentional.
select
  p.oid::regprocedure::text as function_signature,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  case
    when p.proname in ('staff_login','staff_attendance','staff_logout','staff_me')
      then 'REVIEW: staff PIN/token flow; verify rate limits, token validation and output minimization'
    else 'REVIEW: confirm anonymous execution is intended'
  end as review_action
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by p.proname, function_signature;

-- 3) COGS operational tables should not permit direct client-side writes.
-- All DML should pass through permission-checked RPCs.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
  has_table_privilege('anon', c.oid, 'DELETE') as anon_delete,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_delete
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'cogs_wip','cogs_menus','cogs_wip_recipe_lines','cogs_menu_recipe_lines',
    'cogs_production_batches','cogs_production_inputs','cogs_menu_sales',
    'cogs_menu_sales_lines','cogs_daily_so','cogs_daily_so_lines'
  )
order by c.relname;

-- 4) RLS-enabled tables with no policies require deliberate review.
-- A backup/session table may be intentionally inaccessible; do not auto-create permissive policies.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(pol.polname) as policy_count
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_policy pol on pol.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
group by c.relname, c.relrowsecurity
having count(pol.polname) = 0
order by c.relname;

-- 5) Stored-row integrity checks. Expected issue_count = 0 for every check.
select 'wip_missing_division' as check_name, count(*)::bigint as issue_count
from public.cogs_wip where division_id is null
union all
select 'menus_missing_division', count(*)::bigint
from public.cogs_menus where division_id is null
union all
select 'duplicate_posted_opening_wip', count(*)::bigint
from (
  select division_id, wip_id
  from public.cogs_production_batches
  where cost_source = 'opening' and status = 'posted'
  group by division_id, wip_id having count(*) > 1
) d
union all
select 'supplies_in_wip_recipe', count(*)::bigint
from public.cogs_wip_recipe_lines l
join public.barapp_items i on i.id = l.item_id
where l.component_type = 'material' and coalesce(i.is_supply, false) = true
union all
select 'supplies_in_menu_recipe', count(*)::bigint
from public.cogs_menu_recipe_lines l
join public.barapp_items i on i.id = l.item_id
where l.component_type = 'material' and coalesce(i.is_supply, false) = true
union all
select 'production_status_timestamp_mismatch', count(*)::bigint
from public.cogs_production_batches
where (status = 'posted' and (cancelled_at is not null or cancelled_by is not null))
   or (status = 'cancelled' and (cancelled_at is null or cancelled_by is null))
union all
select 'production_total_cost_mismatch', count(*)::bigint
from public.cogs_production_batches
where abs(total_cost_snapshot - produced_qty * unit_cost_snapshot) > 0.01
union all
select 'production_input_cost_mismatch', count(*)::bigint
from public.cogs_production_inputs
where abs(total_cost_snapshot - qty_base * unit_cost_snapshot) > 0.01
union all
select 'sales_status_timestamp_mismatch', count(*)::bigint
from public.cogs_menu_sales
where (status = 'posted' and (cancelled_at is not null or cancelled_by is not null))
   or (status = 'cancelled' and (cancelled_at is null or cancelled_by is null))
union all
select 'sales_total_hpp_mismatch', count(*)::bigint
from public.cogs_menu_sales
where abs(total_hpp_snapshot - qty * unit_hpp_snapshot) > 0.01
union all
select 'sales_gross_mismatch', count(*)::bigint
from public.cogs_menu_sales
where abs(gross_sales_snapshot - qty * selling_price_snapshot) > 0.01
union all
select 'sales_line_cost_mismatch', count(*)::bigint
from public.cogs_menu_sales_lines
where abs(total_cost_snapshot - qty_base * unit_cost_snapshot) > 0.01
union all
select 'daily_so_variance_mismatch', count(*)::bigint
from public.cogs_daily_so_lines
where abs(variance_qty_base - (counted_qty_base - expected_qty_base)) > 0.000001
union all
select 'daily_so_status_timestamp_mismatch', count(*)::bigint
from public.cogs_daily_so
where (status = 'submitted' and voided_at is not null)
   or (status = 'void' and voided_at is null)
union all
select 'stock_out_invalid_type_or_target', count(*)::bigint
from public.barapp_stock_out
where item_type not in ('material','wip') or item_type is null
   or qty_base is null or qty_base <= 0
   or (item_type = 'material' and item_id is null)
   or (item_type = 'wip' and wip_id is null)
union all
select 'stock_out_status_timestamp_mismatch', count(*)::bigint
from public.barapp_stock_out
where (status = 'posted' and (cancelled_at is not null or cancelled_by is not null))
   or (status = 'cancelled' and (cancelled_at is null or cancelled_by is null))
union all
select 'move_missing_destination', count(*)::bigint
from public.barapp_stock_out
where status = 'posted' and category = 'Move'
  and (to_division_id is null or from_division_id is null or from_division_id = to_division_id
    or (item_type = 'material' and target_item_id is null)
    or (item_type = 'wip' and target_wip_id is null))
union all
select 'move_cross_outlet', count(*)::bigint
from public.barapp_stock_out o
join public.divisions f on f.id = o.from_division_id
join public.divisions t on t.id = o.to_division_id
where o.status = 'posted' and o.category = 'Move' and f.outlet_id <> t.outlet_id
union all
select 'posted_returns_exceed_inbound', count(*)::bigint
from (
  select r.stock_in_id
  from public.barapp_stock_returns r
  join public.barapp_stock_in i on i.id = r.stock_in_id
  where r.status = 'posted' and i.status = 'posted'
  group by r.stock_in_id
  having sum(r.qty_base) > max(i.qty_base) + 0.000001
) q
order by check_name;


-- 6) Historical SO components created after the SO effective date need manual review.
-- Nonzero results can indicate backdated test data or legitimate late master-data imports;
-- do not automatically delete/void history. Resolve/approve the interpretation before rollout.
with line_dates as (
  select
    s.id as so_id,
    s.division_id,
    s.so_date,
    l.component_type,
    l.item_id,
    l.component_wip_id,
    case
      when l.component_type = 'material' then (
        select (i.created_at at time zone 'Asia/Jakarta')::date
        from public.barapp_items i where i.id = l.item_id
      )
      when l.component_type = 'wip' then (
        select (w.created_at at time zone 'Asia/Jakarta')::date
        from public.cogs_wip w where w.id = l.component_wip_id
      )
    end as component_created_date
  from public.cogs_daily_so s
  join public.cogs_daily_so_lines l on l.so_id = s.id
  where s.status = 'submitted'
)
select
  so_date,
  division_id,
  count(*) as snapshot_lines,
  count(*) filter (where component_created_date is null) as missing_component_reference,
  count(*) filter (where component_created_date > so_date) as components_created_after_so_date
from line_dates
group by so_id, so_date, division_id
having count(*) filter (where component_created_date > so_date) > 0
    or count(*) filter (where component_created_date is null) > 0
order by so_date, division_id;


-- 7) COGS audit-trigger installation check (read-only).
-- Every row should report trigger_present=true and after_row_insert_update_delete=true.
with expected(table_name, trigger_name) as (
  values
    ('cogs_wip','trg_cogs_audit_wip'),
    ('cogs_wip_recipe_lines','trg_cogs_audit_wip_recipe_lines'),
    ('cogs_menus','trg_cogs_audit_menus'),
    ('cogs_menu_recipe_lines','trg_cogs_audit_menu_recipe_lines'),
    ('cogs_production_batches','trg_cogs_audit_production_batches'),
    ('cogs_production_inputs','trg_cogs_audit_production_inputs'),
    ('cogs_menu_sales','trg_cogs_audit_menu_sales'),
    ('cogs_menu_sales_lines','trg_cogs_audit_menu_sales_lines'),
    ('cogs_daily_so','trg_cogs_audit_daily_so'),
    ('cogs_daily_so_lines','trg_cogs_audit_daily_so_lines')
)
select
  e.table_name,
  e.trigger_name,
  (t.oid is not null) as trigger_present,
  coalesce(
    (t.tgtype & 1) = 1
    and (t.tgtype & 4) = 4
    and (t.tgtype & 8) = 8
    and (t.tgtype & 16) = 16
    and (t.tgtype & 2) = 0
    and (t.tgtype & 64) = 0,
    false
  ) as after_row_insert_update_delete,
  pg_catalog.pg_get_triggerdef(t.oid) as trigger_definition
from expected e
left join pg_catalog.pg_namespace n on n.nspname='public'
left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=e.table_name
left join pg_catalog.pg_trigger t
  on t.tgrelid=c.oid and t.tgname=e.trigger_name and not t.tgisinternal
order by e.table_name;
