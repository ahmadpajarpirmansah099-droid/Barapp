-- BarApp Closing reconciliation trigger repair V1
-- Restores reproducible trigger definitions and makes invalidation safe for UPDATEs
-- that move a transaction between dates/divisions.
-- Apply only to a positively verified staging database after reviewing a restorable backup.
-- The trigger path locks the matching closing period row BEFORE checking its status, so a
-- concurrent operation serializes with approval and will mark the closing dirty after approval
-- commits. Source and destination keys are processed in a stable order to reduce deadlock risk.

begin;

do $preflight$
declare
  v_table text;
begin
  foreach v_table in array array[
    'barapp_closing_periods',
    'audit_log',
    'barapp_stock_in',
    'barapp_stock_out',
    'barapp_stock_returns',
    'barapp_supplies_so',
    'barapp_supplies_so_lines',
    'cogs_daily_so',
    'cogs_daily_so_lines',
    'cogs_menu_sales',
    'cogs_menu_sales_lines',
    'cogs_production_batches',
    'cogs_production_inputs'
  ]
  loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'CLOSING_RECONCILIATION_TRIGGER_TABLE_MISSING: public.%', v_table;
    end if;
  end loop;

  if exists (
    select 1
    from (values
      ('barapp_closing_periods','id'),
      ('barapp_closing_periods','division_id'),
      ('barapp_closing_periods','closing_date'),
      ('barapp_closing_periods','status'),
      ('audit_log','at'),
      ('audit_log','actor'),
      ('audit_log','actor_email'),
      ('audit_log','action'),
      ('audit_log','table_name'),
      ('audit_log','record_id'),
      ('audit_log','old_data'),
      ('audit_log','new_data'),
      ('audit_log','reason'),
      ('barapp_stock_in','division_id'),('barapp_stock_in','received_at'),
      ('barapp_stock_out','from_division_id'),('barapp_stock_out','to_division_id'),
      ('barapp_stock_out','out_date'),('barapp_stock_out','category'),
      ('barapp_stock_returns','division_id'),('barapp_stock_returns','returned_at'),
      ('barapp_supplies_so','division_id'),('barapp_supplies_so','so_date'),
      ('barapp_supplies_so_lines','so_id'),
      ('cogs_daily_so','division_id'),('cogs_daily_so','so_date'),
      ('cogs_daily_so_lines','so_id'),
      ('cogs_menu_sales','division_id'),('cogs_menu_sales','sold_at'),
      ('cogs_menu_sales_lines','sale_id'),
      ('cogs_production_batches','division_id'),('cogs_production_batches','produced_at'),
      ('cogs_production_inputs','batch_id')
    ) as required(table_name,column_name)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema='public'
        and c.table_name=required.table_name
        and c.column_name=required.column_name
    )
  ) then
    raise exception 'CLOSING_RECONCILIATION_TRIGGER_COLUMN_MISSING: inspect required columns before applying';
  end if;
end;
$preflight$;

-- Resolve the affected closing keys from either OLD or NEW row images. For detail lines,
-- look up the parent transaction so a changed/deleted parent key is not guessed from NEW.
create or replace function public.barapp_closing_reconciliation_keys(
  p_table_name text,
  p_row jsonb
) returns table(
  division_id uuid,
  closing_date date,
  destination_division_id uuid
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $keys$
begin
  case p_table_name
    when 'barapp_stock_in' then
      return query select nullif(p_row->>'division_id','')::uuid,
                          nullif(p_row->>'received_at','')::date,
                          null::uuid;
    when 'barapp_stock_returns' then
      return query select nullif(p_row->>'division_id','')::uuid,
                          nullif(p_row->>'returned_at','')::date,
                          null::uuid;
    when 'barapp_stock_out' then
      return query select nullif(p_row->>'from_division_id','')::uuid,
                          nullif(p_row->>'out_date','')::date,
                          case when p_row->>'category'='Move'
                               then nullif(p_row->>'to_division_id','')::uuid
                               else null::uuid end;
    when 'barapp_supplies_so' then
      return query select nullif(p_row->>'division_id','')::uuid,
                          nullif(p_row->>'so_date','')::date,
                          null::uuid;
    when 'cogs_daily_so' then
      return query select nullif(p_row->>'division_id','')::uuid,
                          nullif(p_row->>'so_date','')::date,
                          null::uuid;
    when 'cogs_menu_sales' then
      return query select nullif(p_row->>'division_id','')::uuid,
                          nullif(p_row->>'sold_at','')::date,
                          null::uuid;
    when 'cogs_production_batches' then
      return query select nullif(p_row->>'division_id','')::uuid,
                          nullif(p_row->>'produced_at','')::date,
                          null::uuid;
    when 'barapp_supplies_so_lines' then
      return query
        select s.division_id, s.so_date, null::uuid
        from public.barapp_supplies_so s
        where s.id = nullif(p_row->>'so_id','')::uuid;
    when 'cogs_daily_so_lines' then
      return query
        select s.division_id, s.so_date, null::uuid
        from public.cogs_daily_so s
        where s.id = nullif(p_row->>'so_id','')::uuid;
    when 'cogs_menu_sales_lines' then
      return query
        select s.division_id, s.sold_at, null::uuid
        from public.cogs_menu_sales s
        where s.id = nullif(p_row->>'sale_id','')::uuid;
    when 'cogs_production_inputs' then
      return query
        select b.division_id, b.produced_at, null::uuid
        from public.cogs_production_batches b
        where b.id = nullif(p_row->>'batch_id','')::uuid;
    else
      return;
  end case;
end;
$keys$;

-- Lock first, then inspect the newest row version. This serializes operational changes with
-- the approval transaction; filtering by status in the locking SELECT would miss the race
-- where an approved status is still uncommitted.
create or replace function public.barapp_closing_mark_one_reconciliation(
  p_division_id uuid,
  p_closing_date date,
  p_source_table text
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $mark_one$
declare
  v_period record;
  v_new jsonb;
begin
  if p_division_id is null or p_closing_date is null then
    return;
  end if;

  for v_period in
    select p.id, p.status, to_jsonb(p) as old_period
    from public.barapp_closing_periods p
    where p.division_id = p_division_id
      and p.closing_date = p_closing_date
    for update of p
  loop
    if v_period.status = 'approved' then
      update public.barapp_closing_periods p
         set status = 'needs_reconciliation'
       where p.id = v_period.id
         and p.status = 'approved'
       returning to_jsonb(p.*) into v_new;

      if found then
        insert into public.audit_log(
          at, actor, actor_email, action, table_name, record_id,
          old_data, new_data, reason
        ) values (
          now(), auth.uid(), auth.jwt()->>'email',
          'closing_marked_needs_reconciliation', 'barapp_closing_periods',
          v_period.id::text, v_period.old_period, v_new,
          'Transaksi terkait berubah setelah closing disetujui: ' ||
            coalesce(p_source_table, 'unknown')
        );
      end if;
    end if;
  end loop;
end;
$mark_one$;

-- Combine OLD and NEW period keys, sort them once, then lock them in a stable order. For a
-- Move transaction this includes both source and destination divisions.
create or replace function public.barapp_closing_mark_reconciliation_rows(
  p_table_name text,
  p_old_row jsonb,
  p_new_row jsonb
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $mark_rows$
declare
  k record;
begin
  for k in
    select distinct affected.division_id, affected.closing_date
    from (
      select x.division_id, x.closing_date
      from public.barapp_closing_reconciliation_keys(p_table_name, p_old_row) x
      union all
      select x.destination_division_id, x.closing_date
      from public.barapp_closing_reconciliation_keys(p_table_name, p_old_row) x
      where x.destination_division_id is not null
      union all
      select x.division_id, x.closing_date
      from public.barapp_closing_reconciliation_keys(p_table_name, p_new_row) x
      union all
      select x.destination_division_id, x.closing_date
      from public.barapp_closing_reconciliation_keys(p_table_name, p_new_row) x
      where x.destination_division_id is not null
    ) affected
    where affected.division_id is not null
      and affected.closing_date is not null
    order by affected.division_id, affected.closing_date
  loop
    perform public.barapp_closing_mark_one_reconciliation(
      k.division_id, k.closing_date, p_table_name
    );
  end loop;
end;
$mark_rows$;

create or replace function public.barapp_closing_mark_reconciliation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $trigger$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    v_old := null;
    v_new := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_new := null;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  end if;

  perform public.barapp_closing_mark_reconciliation_rows(
    tg_table_name, v_old, v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$trigger$;

revoke all on function public.barapp_closing_reconciliation_keys(text,jsonb)
  from public, anon, authenticated;
revoke all on function public.barapp_closing_mark_one_reconciliation(uuid,date,text)
  from public, anon, authenticated;
revoke all on function public.barapp_closing_mark_reconciliation_rows(text,jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.barapp_closing_mark_reconciliation()
  from public, anon, authenticated;

do $install_triggers$
declare
  r record;
begin
  for r in
    select * from (values
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
    ) as t(table_name, trigger_name)
  loop
    execute format('drop trigger if exists %I on public.%I', r.trigger_name, r.table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.barapp_closing_mark_reconciliation()',
      r.trigger_name, r.table_name
    );
  end loop;
end;
$install_triggers$;

commit;
