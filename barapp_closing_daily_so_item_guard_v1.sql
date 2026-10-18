-- BarApp Closing Daily SO item-set guard V1
-- Apply to a VERIFIED staging database first. This migration does not alter or delete
-- operational transaction rows. It validates that a Daily SO's saved component set still
-- validates the submitted SO snapshot's component references and internal consistency.
-- Historical/backdated SO remains valid when catalog rows were registered later; the guard
-- checks the saved snapshot, not today's active catalog set.
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

  -- Historical/backdated SO is validated against its saved snapshot. Current-day
  -- SO must also match today's active component set before it can be confirmed.
  select count(*)
  into v_actual_count
  from public.cogs_daily_so_lines l
  where l.so_id = v_so_id;

  if v_actual_count = 0 then
    return false;
  end if;

  -- Each line must identify exactly one supported component type, with no duplicate
  -- component keys in the submitted snapshot.
  if exists (
    select 1
    from public.cogs_daily_so_lines l
    where l.so_id = v_so_id
      and (
        (l.component_type = 'material'
          and (l.item_id is null or l.component_wip_id is not null))
        or
        (l.component_type = 'wip'
          and (l.component_wip_id is null or l.item_id is not null))
        or l.component_type not in ('material','wip')
        or l.component_type is null
      )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.cogs_daily_so_lines l
    where l.so_id = v_so_id
    group by l.component_type, l.item_id, l.component_wip_id
    having count(*) > 1
  ) then
    return false;
  end if;

  -- Verify references and division ownership. A later active/inactive or supply
  -- reclassification must not retroactively invalidate a backdated snapshot.
  if exists (
    select 1
    from public.cogs_daily_so_lines l
    left join public.barapp_items i
      on i.id = l.item_id
     and i.division_id = p_division_id
    where l.so_id = v_so_id
      and l.component_type = 'material'
      and (
        i.id is null
        or (p_closing_date = (now() at time zone 'Asia/Jakarta')::date
            and (i.active is not true or coalesce(i.is_supply, false) = true))
      )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.cogs_daily_so_lines l
    left join public.cogs_wip w
      on w.id = l.component_wip_id
     and w.division_id = p_division_id
    where l.so_id = v_so_id
      and l.component_type = 'wip'
      and (
        w.id is null
        or (p_closing_date = (now() at time zone 'Asia/Jakarta')::date
            and (w.active is not true
                 or not public.division_module_enabled(p_division_id, 'cogs_wip')))
      )
  ) then
    return false;
  end if;

  if p_closing_date = (now() at time zone 'Asia/Jakarta')::date then
    select
      (select count(*)
       from public.barapp_items i
       where i.division_id = p_division_id
         and i.active = true
         and coalesce(i.is_supply, false) = false)
      +
      (case when public.division_module_enabled(p_division_id, 'cogs_wip')
        then (select count(*)
              from public.cogs_wip w
              where w.division_id = p_division_id
                and w.active = true)
        else 0 end)
    into v_expected_count;

    if v_expected_count <> v_actual_count then
      return false;
    end if;

    if exists (
      select 1
      from public.barapp_items i
      where i.division_id = p_division_id
        and i.active = true
        and coalesce(i.is_supply, false) = false
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

-- Approval must not re-derive a historical SO from today's active catalog. For
-- backdated closing, retain the submitted expected/count/cost snapshot. Today's closing
-- still requires exact component-set equality and refreshes expected quantities as before.
create or replace function public.barapp_closing_approve(
  p_division_id uuid,
  p_closing_date date,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $barapp_closing_approve$
declare
  v_period uuid;
  v_missing text[];
  v_changed text[];
  m record;
  v_expected_count integer;
  v_so_id uuid;
  v_summary jsonb;
  v_old jsonb;
  v_modules text[];
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  perform public.barapp_closing_assert_access();

  if not public.barapp_can_access_division(p_division_id) then
    raise exception 'CLOSING_DIVISION_FORBIDDEN' using errcode='42501';
  end if;

  if p_closing_date is null or p_closing_date > v_today then
    raise exception 'CLOSING_INVALID_DATE';
  end if;

  select id into v_period
  from public.barapp_closing_periods
  where division_id=p_division_id and closing_date=p_closing_date
  for update;

  if v_period is null then
    raise exception 'CLOSING_NOT_STARTED';
  end if;

  select to_jsonb(p) into v_old
  from public.barapp_closing_periods p
  where p.id=v_period;

  if (select status from public.barapp_closing_periods where id=v_period)='approved' then
    raise exception 'CLOSING_ALREADY_APPROVED';
  end if;

  select array_agg(x.module_key) into v_modules
  from (
    select 'pengeluaran'::text as module_key
    union all select 'barang_masuk'
    union all select 'daily_so' where public.division_module_enabled(p_division_id,'cogs_daily_so')
    union all select 'sales' where public.division_module_enabled(p_division_id,'cogs_sales')
    union all select 'produksi_wip' where public.division_module_enabled(p_division_id,'cogs_production')
    union all select 'suplies' where public.division_module_enabled(p_division_id,'supplies')
  ) x;

  select array_agg(x.module_key) into v_missing
  from unnest(v_modules) x(module_key)
  where not exists (
    select 1 from public.barapp_closing_modules cm
    where cm.closing_id=v_period and cm.module_key=x.module_key
      and cm.status in ('confirmed','confirmed_empty')
  );

  if coalesce(array_length(v_missing,1),0)>0 then
    raise exception 'CLOSING_MODULES_INCOMPLETE: %',array_to_string(v_missing,',');
  end if;

  for m in
    select module_key,snapshot
    from public.barapp_closing_modules
    where closing_id=v_period and module_key=any(v_modules)
  loop
    if public.barapp_closing_module_snapshot(p_division_id,p_closing_date,m.module_key)
       is distinct from m.snapshot then
      v_changed:=array_append(coalesce(v_changed,array[]::text[]),m.module_key);
    end if;
  end loop;

  if coalesce(array_length(v_changed,1),0)>0 then
    update public.barapp_closing_periods
    set status='needs_reconciliation'
    where id=v_period;

    insert into public.audit_log(at,actor,actor_email,action,table_name,record_id,old_data,new_data,reason)
    values(now(),auth.uid(),auth.jwt()->>'email','closing_reconciliation_required',
      'barapp_closing_periods',v_period::text,v_old,
      jsonb_build_object('status','needs_reconciliation','changed_modules',to_jsonb(v_changed)),
      'Data berubah saat proses approval');

    return jsonb_build_object('closing_id',v_period,'status','needs_reconciliation',
      'changed_modules',to_jsonb(v_changed));
  end if;

  if public.division_module_enabled(p_division_id,'cogs_daily_so') then
    select id into v_so_id
    from public.cogs_daily_so
    where division_id=p_division_id and so_date=p_closing_date and status='submitted'
    order by created_at desc limit 1;

    if v_so_id is null then
      raise exception 'CLOSING_DAILY_SO_REQUIRED';
    end if;

    if not public.barapp_closing_daily_so_item_set_matches(p_division_id,p_closing_date) then
      raise exception 'CLOSING_SO_ITEM_SET_CHANGED'
        using detail='Daily SO snapshot has invalid, duplicate, or cross-division component references.';
    end if;

    if p_closing_date = v_today then
      select count(*) into v_expected_count
      from public.cogs_get_stock_position(p_division_id,p_closing_date);

      if v_expected_count<>(select count(*) from public.cogs_daily_so_lines where so_id=v_so_id) then
        raise exception 'CLOSING_SO_ITEM_SET_CHANGED';
      end if;

      -- Count equality alone can miss a different component set with the same number
      -- of rows. Require a two-way exact match before refreshing today's expected values.
      if exists (
        select 1
        from public.cogs_get_stock_position(p_division_id,p_closing_date) p
        where not exists (
          select 1
          from public.cogs_daily_so_lines l
          where l.so_id=v_so_id
            and l.component_type=p.component_type
            and (case when p.component_type='material' then l.item_id else l.component_wip_id end)=p.component_id
        )
      ) or exists (
        select 1
        from public.cogs_daily_so_lines l
        where l.so_id=v_so_id
          and not exists (
            select 1
            from public.cogs_get_stock_position(p_division_id,p_closing_date) p
            where p.component_type=l.component_type
              and p.component_id=(case when l.component_type='material' then l.item_id else l.component_wip_id end)
          )
      ) then
        raise exception 'CLOSING_SO_ITEM_SET_CHANGED';
      end if;

      update public.cogs_daily_so_lines l
      set expected_qty_base=p.expected_qty_base,
          variance_qty_base=l.counted_qty_base-p.expected_qty_base,
          unit_cost_snapshot=p.unit_cost,
          variance_value_snapshot=case when p.unit_cost is null then null else (l.counted_qty_base-p.expected_qty_base)*p.unit_cost end
      from public.cogs_get_stock_position(p_division_id,p_closing_date) p
      where l.so_id=v_so_id
        and l.component_type=p.component_type
        and (case when p.component_type='material' then l.item_id else l.component_wip_id end)=p.component_id;

      if (select count(*) from public.cogs_daily_so_lines where so_id=v_so_id)
         < > v_expected_count then
        raise exception 'CLOSING_SO_ITEM_SET_CHANGED';
      end if;
    end if;
    -- Historical/backdated closing deliberately keeps its submitted expected, variance,
    -- and cost snapshot. The current catalog and live stock position are not historical facts.
  end if;

  update public.barapp_closing_modules cm
  set snapshot=public.barapp_closing_module_snapshot(p_division_id,p_closing_date,cm.module_key)
  where cm.closing_id=v_period and cm.module_key=any(v_modules);

  select jsonb_build_object(
    'daily_so_items',(select count(*) from public.cogs_daily_so_lines where so_id=v_so_id),
    'variance_items',(select count(*) from public.cogs_daily_so_lines where so_id=v_so_id and abs(variance_qty_base)>0.000001),
    'variance_value',(select coalesce(sum(abs(variance_value_snapshot)),0) from public.cogs_daily_so_lines where so_id=v_so_id),
    'approved_at',now(),'approved_by',auth.uid()
  ) into v_summary;

  update public.barapp_closing_periods
  set status='approved',approved_by=auth.uid(),approved_at=now(),summary=v_summary,
      notes=coalesce(nullif(trim(coalesce(p_note,'')),''),notes)
  where id=v_period;

  insert into public.audit_log(at,actor,actor_email,action,table_name,record_id,old_data,new_data,reason)
  values(now(),auth.uid(),auth.jwt()->>'email','closing_approved','barapp_closing_periods',
    v_period::text,v_old,
    jsonb_build_object('status','approved','summary',v_summary,'division_id',p_division_id,
      'closing_date',p_closing_date),
    nullif(trim(coalesce(p_note,'')),''));

  return jsonb_build_object('closing_id',v_period,'status','approved','summary',v_summary);
end;
$barapp_closing_approve$;

revoke all on function public.barapp_closing_approve(uuid,date,text) from public, anon;
grant execute on function public.barapp_closing_approve(uuid,date,text) to authenticated;

-- Preserve the existing authenticated calling surface for the public closing RPC,
-- but keep the internal boolean helper private to client roles.
revoke all on function public.barapp_closing_confirm_module(uuid,date,text,boolean,text)
  from public, anon;
grant execute on function public.barapp_closing_confirm_module(uuid,date,text,boolean,text)
  to authenticated;
