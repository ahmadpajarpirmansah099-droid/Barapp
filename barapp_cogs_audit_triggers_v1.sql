-- BarApp COGS audit triggers V1
-- Apply AFTER barapp_cogs_operations_v1.sql and BEFORE barapp_security_hardening_v1.sql.
-- This migration writes only to audit_log through triggers; it does not rewrite operational rows.
-- Apply to a positively identified staging database first, then verify audit events end-to-end.

begin;

-- Fail closed if the active schema or audit-log contract differs from this migration.
do $preflight$
declare
  r record;
  v_missing text[] := array[]::text[];
begin
  for r in
    select * from (values
      ('audit_log','at'), ('audit_log','actor'), ('audit_log','actor_email'),
      ('audit_log','action'), ('audit_log','table_name'), ('audit_log','record_id'),
      ('audit_log','old_data'), ('audit_log','new_data'), ('audit_log','reason'),
      ('cogs_wip','id'),
      ('cogs_wip_recipe_lines','id'), ('cogs_wip_recipe_lines','wip_id'),
      ('cogs_menus','id'),
      ('cogs_menu_recipe_lines','id'), ('cogs_menu_recipe_lines','menu_id'),
      ('cogs_production_batches','id'), ('cogs_production_batches','status'), ('cogs_production_batches','notes'),
      ('cogs_production_inputs','id'), ('cogs_production_inputs','batch_id'),
      ('cogs_menu_sales','id'), ('cogs_menu_sales','status'), ('cogs_menu_sales','notes'),
      ('cogs_menu_sales_lines','id'), ('cogs_menu_sales_lines','sale_id'),
      ('cogs_daily_so','id'), ('cogs_daily_so','status'), ('cogs_daily_so','notes'),
      ('cogs_daily_so_lines','id'), ('cogs_daily_so_lines','so_id')
    ) as required(table_name, column_name)
  loop
    if to_regclass(format('public.%I', r.table_name)) is null
       or not exists (
         select 1 from information_schema.columns c
         where c.table_schema='public'
           and c.table_name=r.table_name
           and c.column_name=r.column_name
       ) then
      v_missing := array_append(v_missing, r.table_name || '.' || r.column_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'COGS_AUDIT_PREFLIGHT_FAILED: missing required tables/columns: %',
      array_to_string(v_missing, ', ');
  end if;
end;
$preflight$;

create or replace function public.barapp_cogs_audit_row()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $audit$
declare
  v_old jsonb;
  v_new jsonb;
  v_action text;
  v_record_id text;
  v_reason text;
  v_old_notes text;
  v_new_notes text;
begin
  if TG_OP = 'INSERT' then
    v_old := null;
    v_new := to_jsonb(NEW);
    v_action := 'cogs_record_created';
  elsif TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_new := null;
    v_action := 'cogs_record_deleted';
  else
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    if coalesce(v_new->>'status', '') in ('cancelled', 'void')
       and coalesce(v_old->>'status', '') not in ('cancelled', 'void') then
      v_action := 'cogs_record_cancelled';
      -- Cancellation RPCs append a supplied reason to notes. Store only the appended
      -- suffix as reason; opening-WIP cancellation may leave notes unchanged and has no reason.
      v_old_notes := v_old->>'notes';
      v_new_notes := v_new->>'notes';
      v_reason := null;
      if coalesce(v_new_notes, '') <> coalesce(v_old_notes, '') then
        if v_old_notes is null or v_old_notes = '' then
          v_reason := nullif(btrim(v_new_notes), '');
        elsif left(coalesce(v_new_notes, ''), length(v_old_notes) + 1) = v_old_notes || E'\n' then
          v_reason := nullif(btrim(substr(v_new_notes, length(v_old_notes) + 2)), '');
        end if;
      end if;
    else
      v_action := 'cogs_record_updated';
    end if;
  end if;

  v_record_id := coalesce(v_new->>'id', v_old->>'id');
  if v_record_id is null then
    raise exception 'COGS_AUDIT_RECORD_ID_MISSING for table %', TG_TABLE_NAME;
  end if;

  insert into public.audit_log(
    at, actor, actor_email, action, table_name, record_id,
    old_data, new_data, reason
  ) values (
    now(),
    auth.uid(),
    auth.jwt()->>'email',
    v_action,
    TG_TABLE_NAME,
    v_record_id,
    v_old,
    v_new,
    v_reason
  );

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$audit$;

revoke all on function public.barapp_cogs_audit_row() from public, anon, authenticated;

do $install_triggers$
declare
  r record;
begin
  for r in
    select * from (values
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
    ) as targets(table_name, trigger_name)
    order by table_name
  loop
    execute format('drop trigger if exists %I on public.%I', r.trigger_name, r.table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.barapp_cogs_audit_row()',
      r.trigger_name, r.table_name
    );
  end loop;
end;
$install_triggers$;

commit;
