-- BarApp Closing Daily SO item-set guard V1
-- Apply to a VERIFIED staging database first. This migration does not alter or delete
-- operational transaction rows. It validates that a Daily SO's saved component set still
-- matches active non-SUPPLIES material and enabled WIP items valid on the closing date.
-- This catches legacy/backdated SO snapshots at confirmation time, rather than letting the
-- closing workflow proceed until final approval fails.
--
-- The internal helper is not executable by client roles. Closing access remains separate
-- from COGS edit permissions: the helper uses the closing role/scope guard and does not call
-- permission-gated cogs_get_stock_position.

create or replace function public.barapp_closing_daily_so_item_set_matches(
  p_division_id uuid,
  p_closing_date date
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $barapp_closing_so_item_guard$
declare
  v_so_id uuid;
  v_expected_count integer := 0;
  v_actual_count integer := 0;
begin
  perform public.barapp_closing_assert_access();

  if not public.barapp_can_access_division(p_division_id) then
    raise exception 'CLOSING_DIVISION_FORBIDDEN' using errcode = '42501';
  end if;

  if p_division_id is null or p_closing_date is null
     or p_closing_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'CLOSING_INVALID_DATE';
  end if;

  select s.id
  into v_so_id
  from public.cogs_daily_so s
  where s.division_id = p_division_id
    and s.so_date = p_closing_date
    and s.status = 'submitted'
  order by s.created_at desc
  limit 1;

  if v_so_id is null then
    return false;
  end if;

  select
    (select count(*)
     from public.barapp_items i
     where i.division_id = p_division_id
       and i.active = true
       and coalesce(i.is_supply, false) = false
       and (i.created_at at time zone 'Asia/Jakarta')::date <= p_closing_date)
    +
    (case when public.division_module_enabled(p_division_id, 'cogs_wip')
      then (select count(*)
            from public.cogs_wip w
            where w.division_id = p_division_id
              and w.active = true
              and (w.created_at at time zone 'Asia/Jakarta')::date <= p_closing_date)
      else 0 end)
  into v_expected_count;

  select count(*)
  into v_actual_count
  from public.cogs_daily_so_lines l
  where l.so_id = v_so_id;

  if v_expected_count <> v_actual_count then
    return false;
  end if;

  if exists (
    select 1
    from public.barapp_items i
    where i.division_id = p_division_id
      and i.active = true
      and coalesce(i.is_supply, false) = false
      and (i.created_at at time zone 'Asia/Jakarta')::date <= p_closing_date
      and not exists (
        select 1
        from public.cogs_daily_so_lines l
        where l.so_id = v_so_id
          and l.component_type = 'material'
          and l.item_id = i.id
      )
  ) then
    return false;
  end if;

  if public.division_module_enabled(p_division_id, 'cogs_wip') and exists (
    select 1
    from public.cogs_wip w
    where w.division_id = p_division_id
      and w.active = true
      and (w.created_at at time zone 'Asia/Jakarta')::date <= p_closing_date
      and not exists (
        select 1
        from public.cogs_daily_so_lines l
        where l.so_id = v_so_id
          and l.component_type = 'wip'
          and l.component_wip_id = w.id
      )
  ) then
    return false;
  end if;

  return true;
end;
$barapp_closing_so_item_guard$;

revoke all on function public.barapp_closing_daily_so_item_set_matches(uuid, date)
  from public, anon, authenticated;

create or replace function public.barapp_closing_confirm_module(
  p_division_id uuid,
  p_closing_date date,
  p_module_key text,
  p_confirmed_empty boolean default false,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $barapp_closing_confirm_module$
declare
  v_outlet uuid;
  v_period uuid;
  v_snap jsonb;
  v_count integer;
  v_status text;
  v_all boolean;
  v_old jsonb;
begin
  perform public.barapp_closing_assert_access();

  if not public.barapp_can_access_division(p_division_id) then
    raise exception 'CLOSING_DIVISION_FORBIDDEN' using errcode = '42501';
  end if;

  if p_closing_date is null
     or p_closing_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'CLOSING_INVALID_DATE';
  end if;

  if p_module_key not in ('daily_so','pengeluaran','sales','barang_masuk','produksi_wip','suplies') then
    raise exception 'CLOSING_INVALID_MODULE';
  end if;

  if (p_module_key = 'daily_so' and not public.division_module_enabled(p_division_id,'cogs_daily_so'))
     or (p_module_key = 'sales' and not public.division_module_enabled(p_division_id,'cogs_sales'))
     or (p_module_key = 'produksi_wip' and not public.division_module_enabled(p_division_id,'cogs_production'))
     or (p_module_key = 'suplies' and not public.division_module_enabled(p_division_id,'supplies')) then
    raise exception 'CLOSING_MODULE_DISABLED';
  end if;

  if p_module_key = 'daily_so' then
    if not exists (
      select 1 from public.cogs_daily_so s
      where s.division_id = p_division_id
        and s.so_date = p_closing_date
        and s.status = 'submitted'
    ) then
      raise exception 'CLOSING_DAILY_SO_REQUIRED';
    end if;

    if not public.barapp_closing_daily_so_item_set_matches(p_division_id,p_closing_date) then
      raise exception 'CLOSING_SO_ITEM_SET_CHANGED'
        using detail = 'Daily SO item set does not match active materials/WIP valid on the closing date. Reconcile the SO before confirming.';
    end if;
  end if;

  select outlet_id
  into v_outlet
  from public.divisions
  where id = p_division_id and active = true;

  if v_outlet is null then
    raise exception 'CLOSING_DIVISION_INVALID';
  end if;

  v_snap := public.barapp_closing_module_snapshot(p_division_id,p_closing_date,p_module_key);
  v_count := coalesce((v_snap->>'count')::integer,0);

  if p_module_key = 'daily_so' and v_count = 0 then
    raise exception 'CLOSING_DAILY_SO_REQUIRED';
  end if;
  if p_confirmed_empty and v_count > 0 then
    raise exception 'CLOSING_MODULE_HAS_DATA';
  end if;
  if not p_confirmed_empty and v_count = 0 then
    raise exception 'CLOSING_CONFIRM_EMPTY_REQUIRED';
  end if;

  insert into public.barapp_closing_periods(outlet_id,division_id,closing_date,created_by)
  values(v_outlet,p_division_id,p_closing_date,auth.uid())
  on conflict(division_id,closing_date) do nothing;

  select id
  into v_period
  from public.barapp_closing_periods
  where division_id = p_division_id and closing_date = p_closing_date
  for update;

  if exists(select 1 from public.barapp_closing_periods where id = v_period and status = 'approved') then
    raise exception 'CLOSING_ALREADY_APPROVED';
  end if;

  select to_jsonb(cm)
  into v_old
  from public.barapp_closing_modules cm
  where cm.closing_id = v_period and cm.module_key = p_module_key;

  v_status := case when p_confirmed_empty then 'confirmed_empty' else 'confirmed' end;

  insert into public.barapp_closing_modules(closing_id,module_key,status,snapshot,confirmed_by,confirmed_at,note)
  values(v_period,p_module_key,v_status,v_snap,auth.uid(),now(),nullif(trim(coalesce(p_note,'')), ''))
  on conflict(closing_id,module_key) do update
    set status=excluded.status,
        snapshot=excluded.snapshot,
        confirmed_by=excluded.confirmed_by,
        confirmed_at=excluded.confirmed_at,
        note=excluded.note;

  select count(*) = (
    select count(*) from (
      select 'pengeluaran'::text as module_key
      union all select 'barang_masuk'
      union all select 'daily_so' where public.division_module_enabled(p_division_id,'cogs_daily_so')
      union all select 'sales' where public.division_module_enabled(p_division_id,'cogs_sales')
      union all select 'produksi_wip' where public.division_module_enabled(p_division_id,'cogs_production')
      union all select 'suplies' where public.division_module_enabled(p_division_id,'supplies')
    ) active_modules
  )
  into v_all
  from public.barapp_closing_modules
  where closing_id = v_period
    and status in ('confirmed','confirmed_empty')
    and module_key in ('pengeluaran','barang_masuk','daily_so','sales','produksi_wip','suplies')
    and (
      module_key in ('pengeluaran','barang_masuk')
      or (module_key = 'daily_so' and public.division_module_enabled(p_division_id,'cogs_daily_so'))
      or (module_key = 'sales' and public.division_module_enabled(p_division_id,'cogs_sales'))
      or (module_key = 'produksi_wip' and public.division_module_enabled(p_division_id,'cogs_production'))
      or (module_key = 'suplies' and public.division_module_enabled(p_division_id,'supplies'))
    );

  update public.barapp_closing_periods
  set status = case when v_all then 'ready' else 'draft' end,
      summary = '{}'::jsonb
  where id = v_period;

  insert into public.audit_log(at,actor,actor_email,action,table_name,record_id,old_data,new_data,reason)
  values(now(),auth.uid(),auth.jwt()->>'email','closing_module_confirmed','barapp_closing_modules',
    v_period::text||':'||p_module_key,v_old,
    jsonb_build_object('status',v_status,'snapshot',v_snap,'closing_date',p_closing_date,
      'division_id',p_division_id),
    nullif(trim(coalesce(p_note,'')), ''));

  return jsonb_build_object('closing_id',v_period,'module_key',p_module_key,'status',v_status,
    'snapshot',v_snap,'closing_status',case when v_all then 'ready' else 'draft' end);
end;
$barapp_closing_confirm_module$;

-- Preserve the existing authenticated calling surface for the public closing RPC,
-- but keep the internal boolean helper private to client roles.
revoke all on function public.barapp_closing_confirm_module(uuid,date,text,boolean,text)
  from public, anon;
grant execute on function public.barapp_closing_confirm_module(uuid,date,text,boolean,text)
  to authenticated;
