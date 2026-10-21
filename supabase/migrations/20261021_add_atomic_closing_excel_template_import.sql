-- Atomic Excel template import for Approval Closing.
-- Apply after the operational and closing modules are installed.

create table if not exists public.barapp_closing_template_imports (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  outlet_id uuid not null references public.outlets(id),
  division_id uuid not null references public.divisions(id),
  target_date date not null,
  payload_hash text not null,
  imported_by uuid not null,
  imported_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb,
  constraint barapp_closing_template_imports_template_id_key unique (template_id),
  constraint barapp_closing_template_imports_payload_key unique (division_id, target_date, payload_hash)
);

alter table public.barapp_closing_template_imports enable row level security;
revoke all on table public.barapp_closing_template_imports from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.barapp_closing_import_template(p_division_id uuid, p_target_date date, p_template_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_outlet_id uuid;
  v_period_status text;
  v_daily jsonb := coalesce(p_payload->'daily_so','[]'::jsonb);
  v_sales jsonb := coalesce(p_payload->'sales','[]'::jsonb);
  v_stock_in jsonb := coalesce(p_payload->'stock_in','[]'::jsonb);
  v_opening_wip jsonb := coalesce(p_payload->'opening_wip','[]'::jsonb);
  v_stock_out jsonb := coalesce(p_payload->'stock_out','[]'::jsonb);
  v_production jsonb := coalesce(p_payload->'production','[]'::jsonb);
  v_supplies jsonb := coalesce(p_payload->'supplies','[]'::jsonb);
  v_hash text;
  v_import_id uuid;
  v_daily_id uuid;
  v_supplies_id uuid;
  v_sales_count integer := 0;
  v_production_count integer := 0;
  v_stock_in_count integer := 0;
  v_opening_wip_count integer := 0;
  v_stock_out_count integer := 0;
  v_type text;
  v_id uuid;
  v_wip_id uuid;
  v_qty numeric;
  v_factor numeric;
  v_unit text;
  v_item public.barapp_items%rowtype;
  v_wip public.cogs_wip%rowtype;
  v_target public.divisions%rowtype;
  r record;
  v_summary jsonb;
begin
  perform public.barapp_closing_assert_access();
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_template_id is null then
    raise exception 'BARAPP_TEMPLATE_INVALID_PAYLOAD';
  end if;
  if p_target_date is null or p_target_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'BARAPP_TEMPLATE_INVALID_DATE';
  end if;
  if not public.barapp_closing_can_access_division(p_division_id) then
    raise exception 'CLOSING_ACCESS_DENIED' using errcode='42501';
  end if;
  select d.outlet_id into v_outlet_id
  from public.divisions d
  where d.id=p_division_id and d.active=true;
  if not found then raise exception 'BARAPP_TEMPLATE_INVALID_DIVISION'; end if;

  if jsonb_typeof(v_daily)<>'array' or jsonb_typeof(v_sales)<>'array'
     or jsonb_typeof(v_stock_in)<>'array' or jsonb_typeof(v_opening_wip)<>'array'
     or jsonb_typeof(v_stock_out)<>'array' or jsonb_typeof(v_production)<>'array'
     or jsonb_typeof(v_supplies)<>'array' then
    raise exception 'BARAPP_TEMPLATE_INVALID_SHEET_DATA';
  end if;
  if jsonb_array_length(v_daily)>1000 or jsonb_array_length(v_sales)>200
     or jsonb_array_length(v_stock_in)>1000 or jsonb_array_length(v_opening_wip)>500
     or jsonb_array_length(v_stock_out)>1000 or jsonb_array_length(v_production)>200
     or jsonb_array_length(v_supplies)>1000 then
    raise exception 'BARAPP_TEMPLATE_TOO_MANY_ROWS';
  end if;
  if jsonb_array_length(v_daily)+jsonb_array_length(v_sales)+jsonb_array_length(v_stock_in)
     +jsonb_array_length(v_opening_wip)+jsonb_array_length(v_stock_out)
     +jsonb_array_length(v_production)+jsonb_array_length(v_supplies)=0 then
    raise exception 'BARAPP_TEMPLATE_EMPTY_IMPORT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_division_id::text||'|'||p_target_date::text,0));
  select status into v_period_status
    from public.barapp_closing_periods
   where division_id=p_division_id and closing_date=p_target_date
   for update;
  if v_period_status in ('approved','needs_reconciliation') then
    raise exception 'BARAPP_TEMPLATE_CLOSING_LOCKED';
  end if;

  -- Reject only sheets that would collide with already-recorded transactions on this date.
  if jsonb_array_length(v_daily)>0 and exists(
    select 1 from public.cogs_daily_so where division_id=p_division_id and so_date=p_target_date and status='submitted'
  ) then raise exception 'BARAPP_TEMPLATE_EXISTING_DAILY_SO'; end if;
  if jsonb_array_length(v_supplies)>0 and exists(
    select 1 from public.barapp_supplies_so where division_id=p_division_id and so_date=p_target_date and status='submitted'
  ) then raise exception 'BARAPP_TEMPLATE_EXISTING_SUPPLIES'; end if;
  if jsonb_array_length(v_sales)>0 and exists(
    select 1 from public.cogs_menu_sales where division_id=p_division_id and sold_at=p_target_date and status='posted'
  ) then raise exception 'BARAPP_TEMPLATE_EXISTING_SALES'; end if;
  if jsonb_array_length(v_stock_in)>0 and exists(
    select 1 from public.barapp_stock_in where division_id=p_division_id and received_at=p_target_date and status='posted'
  ) then raise exception 'BARAPP_TEMPLATE_EXISTING_STOCK_IN'; end if;
  if jsonb_array_length(v_stock_out)>0 and exists(
    select 1 from public.barapp_stock_out where from_division_id=p_division_id and out_date=p_target_date and status='posted'
  ) then raise exception 'BARAPP_TEMPLATE_EXISTING_EXPENSES'; end if;
  if jsonb_array_length(v_production)>0 and exists(
    select 1 from public.cogs_production_batches where division_id=p_division_id and produced_at=p_target_date and status='posted' and cost_source<>'opening'
  ) then raise exception 'BARAPP_TEMPLATE_EXISTING_PRODUCTION'; end if;
  if jsonb_array_length(v_opening_wip)>0 and exists(
    select 1 from public.cogs_production_batches where division_id=p_division_id and produced_at=p_target_date and status='posted' and cost_source='opening'
  ) then raise exception 'BARAPP_TEMPLATE_EXISTING_OPENING_WIP'; end if;

  if jsonb_array_length(v_daily)>0 then
    if not public.division_module_enabled(p_division_id,'cogs_daily_so') or not public.has_perm('cogs.daily_so.edit') then
      raise exception 'BARAPP_TEMPLATE_DAILY_SO_FORBIDDEN' using errcode='42501';
    end if;
    -- Validate quantities and known item types. The native SO RPC verifies full catalogue coverage.
    for r in select * from jsonb_to_recordset(v_daily) as x(item_id uuid,item_type text,qty numeric) loop
      if r.item_id is null or r.item_type not in ('material','wip') or r.qty is null or r.qty<0 then
        raise exception 'BARAPP_TEMPLATE_INVALID_DAILY_SO_ROW';
      end if;
      if r.item_type='material' then
        if not exists(select 1 from public.barapp_items i where i.id=r.item_id and i.division_id=p_division_id and i.active=true and coalesce(i.is_supply,false)=false) then
          raise exception 'BARAPP_TEMPLATE_INVALID_DAILY_SO_ITEM';
        end if;
      else
        if not public.division_module_enabled(p_division_id,'cogs_wip') or not exists(select 1 from public.cogs_wip w where w.id=r.item_id and w.division_id=p_division_id and w.active=true) then
          raise exception 'BARAPP_TEMPLATE_INVALID_DAILY_SO_ITEM';
        end if;
      end if;
    end loop;
    if exists(select 1 from jsonb_to_recordset(v_daily) as x(item_id uuid,item_type text,qty numeric) group by item_id,item_type having count(*)>1) then
      raise exception 'BARAPP_TEMPLATE_DUPLICATE_DAILY_SO_ITEM';
    end if;
  end if;

  if jsonb_array_length(v_sales)>0 then
    if not public.division_module_enabled(p_division_id,'cogs_sales') or not public.has_perm('cogs.sales.manage') then
      raise exception 'BARAPP_TEMPLATE_SALES_FORBIDDEN' using errcode='42501';
    end if;
    for r in select * from jsonb_to_recordset(v_sales) as x(menu_id uuid,qty numeric,selling_price numeric) loop
      if r.menu_id is null or r.qty is null or r.qty<=0 or (r.selling_price is not null and r.selling_price<0)
         or not exists(select 1 from public.cogs_menus m where m.id=r.menu_id and m.division_id=p_division_id and m.active=true) then
        raise exception 'BARAPP_TEMPLATE_INVALID_SALES_ROW';
      end if;
    end loop;
    if exists(select 1 from jsonb_to_recordset(v_sales) as x(menu_id uuid,qty numeric,selling_price numeric) group by menu_id having count(*)>1) then
      raise exception 'BARAPP_TEMPLATE_DUPLICATE_SALES_MENU';
    end if;
  end if;

  if jsonb_array_length(v_stock_in)>0 then
    if not public.barapp_can_manage_division(p_division_id) or not public.has_perm('inventory.view') then
      raise exception 'BARAPP_TEMPLATE_STOCK_IN_FORBIDDEN' using errcode='42501';
    end if;
    for r in select * from jsonb_to_recordset(v_stock_in) as x(item_id uuid,qty numeric,unit text,invoice_total numeric,notes text) loop
      if r.item_id is null or r.qty is null or r.qty<=0 or nullif(trim(coalesce(r.unit,'')),'') is null
         or (r.invoice_total is not null and r.invoice_total<0) then
        raise exception 'BARAPP_TEMPLATE_INVALID_STOCK_IN_ROW';
      end if;
      select * into v_item from public.barapp_items i where i.id=r.item_id and i.division_id=p_division_id and i.active=true;
      if not found then raise exception 'BARAPP_TEMPLATE_INVALID_STOCK_IN_ITEM'; end if;
      select nullif(c->>'factor','')::numeric into v_factor
        from jsonb_array_elements(v_item.conversions) as x(c)
       where lower(trim(c->>'unit'))=lower(trim(r.unit)) limit 1;
      if v_factor is null or v_factor<=0 then raise exception 'BARAPP_TEMPLATE_INVALID_UNIT'; end if;
    end loop;
    if exists(select 1 from jsonb_to_recordset(v_stock_in) as x(item_id uuid,qty numeric,unit text,invoice_total numeric,notes text) group by item_id having count(*)>1) then
      raise exception 'BARAPP_TEMPLATE_DUPLICATE_STOCK_IN_ITEM';
    end if;
  end if;

  if jsonb_array_length(v_opening_wip)>0 then
    if not public.division_module_enabled(p_division_id,'cogs_production')
       or not (public.has_perm('inventory.inbound.manage') or public.has_perm('cogs.production.manage')) then
      raise exception 'BARAPP_TEMPLATE_OPENING_WIP_FORBIDDEN' using errcode='42501';
    end if;
    for r in select * from jsonb_to_recordset(v_opening_wip) as x(wip_id uuid,qty numeric,notes text) loop
      if r.wip_id is null or r.qty is null or r.qty<=0
         or not exists(select 1 from public.cogs_wip w where w.id=r.wip_id and w.division_id=p_division_id and w.active=true) then
        raise exception 'BARAPP_TEMPLATE_INVALID_OPENING_WIP_ROW';
      end if;
    end loop;
    if exists(select 1 from jsonb_to_recordset(v_opening_wip) as x(wip_id uuid,qty numeric,notes text) group by wip_id having count(*)>1) then
      raise exception 'BARAPP_TEMPLATE_DUPLICATE_OPENING_WIP';
    end if;
  end if;

  if jsonb_array_length(v_stock_out)>0 then
    if not public.barapp_can_manage_division(p_division_id) then
      raise exception 'BARAPP_TEMPLATE_EXPENSES_FORBIDDEN' using errcode='42501';
    end if;
    for r in select * from jsonb_to_recordset(v_stock_out) as x(item_type text,item_id uuid,wip_id uuid,qty numeric,unit text,category text,target_division_id uuid,notes text) loop
      if r.item_type not in ('material','wip') or r.qty is null or r.qty<=0
         or nullif(trim(coalesce(r.unit,'')),'') is null
         or r.category not in ('Move','Waste','QC','R&D','Kalibrasi','Lainnya') then
        raise exception 'BARAPP_TEMPLATE_INVALID_EXPENSE_ROW';
      end if;
      if r.item_type='material' then
        if r.item_id is null or r.wip_id is not null then raise exception 'BARAPP_TEMPLATE_INVALID_EXPENSE_ITEM'; end if;
        select * into v_item from public.barapp_items i where i.id=r.item_id and i.division_id=p_division_id and i.active=true;
        if not found then raise exception 'BARAPP_TEMPLATE_INVALID_EXPENSE_ITEM'; end if;
        select nullif(c->>'factor','')::numeric into v_factor from jsonb_array_elements(v_item.conversions) as x(c) where lower(trim(c->>'unit'))=lower(trim(r.unit)) limit 1;
        if v_factor is null or v_factor<=0 then raise exception 'BARAPP_TEMPLATE_INVALID_UNIT'; end if;
      else
        if r.wip_id is null or r.item_id is not null or not public.division_module_enabled(p_division_id,'cogs_wip') then raise exception 'BARAPP_TEMPLATE_INVALID_EXPENSE_ITEM'; end if;
        select * into v_wip from public.cogs_wip w where w.id=r.wip_id and w.division_id=p_division_id and w.active=true;
        if not found or lower(trim(v_wip.yield_unit))<>lower(trim(r.unit)) then raise exception 'BARAPP_TEMPLATE_INVALID_UNIT'; end if;
      end if;
      if r.category='Move' then
        if r.target_division_id is null or r.target_division_id=p_division_id
           or not public.barapp_can_manage_division(r.target_division_id) then
          raise exception 'BARAPP_TEMPLATE_INVALID_MOVE_TARGET';
        end if;
        select * into v_target from public.divisions d where d.id=r.target_division_id and d.active=true and d.outlet_id=v_outlet_id;
        if not found then raise exception 'BARAPP_TEMPLATE_INVALID_MOVE_TARGET'; end if;
        if exists(select 1 from public.barapp_closing_periods cp where cp.division_id=r.target_division_id and cp.closing_date=p_target_date and cp.status in ('approved','needs_reconciliation')) then
          raise exception 'BARAPP_TEMPLATE_TARGET_CLOSING_LOCKED';
        end if;
      elsif r.target_division_id is not null then
        raise exception 'BARAPP_TEMPLATE_NON_MOVE_HAS_TARGET';
      end if;
    end loop;
    if exists(select 1 from jsonb_to_recordset(v_stock_out) as x(item_type text,item_id uuid,wip_id uuid,qty numeric,unit text,category text,target_division_id uuid,notes text) group by item_type,coalesce(item_id,wip_id),category having count(*)>1) then
      raise exception 'BARAPP_TEMPLATE_DUPLICATE_EXPENSE_ITEM';
    end if;
  end if;

  if jsonb_array_length(v_production)>0 then
    if not public.division_module_enabled(p_division_id,'cogs_production') or not public.has_perm('cogs.production.manage') then
      raise exception 'BARAPP_TEMPLATE_PRODUCTION_FORBIDDEN' using errcode='42501';
    end if;
    for r in select * from jsonb_to_recordset(v_production) as x(wip_id uuid,batches numeric) loop
      if r.wip_id is null or r.batches is null or r.batches<=0 or r.batches<>trunc(r.batches)
         or not exists(select 1 from public.cogs_wip w where w.id=r.wip_id and w.division_id=p_division_id and w.active=true) then
        raise exception 'BARAPP_TEMPLATE_INVALID_PRODUCTION_ROW';
      end if;
    end loop;
    if exists(select 1 from jsonb_to_recordset(v_production) as x(wip_id uuid,batches numeric) group by wip_id having count(*)>1) then
      raise exception 'BARAPP_TEMPLATE_DUPLICATE_PRODUCTION_WIP';
    end if;
  end if;

  if jsonb_array_length(v_supplies)>0 then
    if not public.division_module_enabled(p_division_id,'supplies') or not public.barapp_can_manage_division(p_division_id) then
      raise exception 'BARAPP_TEMPLATE_SUPPLIES_FORBIDDEN' using errcode='42501';
    end if;
    for r in select * from jsonb_to_recordset(v_supplies) as x(item_id uuid,qty numeric) loop
      if r.item_id is null or r.qty is null or r.qty<0
         or not exists(select 1 from public.barapp_items i where i.id=r.item_id and i.division_id=p_division_id and i.active=true and i.is_supply=true) then
        raise exception 'BARAPP_TEMPLATE_INVALID_SUPPLIES_ROW';
      end if;
    end loop;
    if exists(select 1 from jsonb_to_recordset(v_supplies) as x(item_id uuid,qty numeric) group by item_id having count(*)>1) then
      raise exception 'BARAPP_TEMPLATE_DUPLICATE_SUPPLIES_ITEM';
    end if;
  end if;

  -- All preflight checks are complete. Writes below run in this single transaction.
  if jsonb_array_length(v_stock_in)>0 then
    for r in select * from jsonb_to_recordset(v_stock_in) as x(item_id uuid,qty numeric,unit text,invoice_total numeric,notes text) loop
      select * into v_item from public.barapp_items i where i.id=r.item_id and i.division_id=p_division_id and i.active=true;
      select nullif(c->>'factor','')::numeric into v_factor from jsonb_array_elements(v_item.conversions) as x(c) where lower(trim(c->>'unit'))=lower(trim(r.unit)) limit 1;
      insert into public.barapp_stock_in(item_id,division_id,received_at,qty_input,unit_input,qty_base,invoice_total,estimated_total,price_source,status,notes,created_by)
      values(r.item_id,p_division_id,p_target_date,r.qty,trim(r.unit),r.qty*v_factor,r.invoice_total,
        case when r.invoice_total is null then r.qty*v_factor*coalesce(v_item.reference_price_per_base,0) else r.invoice_total end,
        case when r.invoice_total is null then 'master' else 'invoice' end,'posted',nullif(trim(coalesce(r.notes,'')),''),auth.uid());
      v_stock_in_count:=v_stock_in_count+1;
    end loop;
  end if;

  if jsonb_array_length(v_opening_wip)>0 then
    for r in select * from jsonb_to_recordset(v_opening_wip) as x(wip_id uuid,qty numeric,notes text) loop
      perform public.cogs_record_opening_wip_stock(p_division_id,r.wip_id,r.qty,p_target_date,r.notes);
      v_opening_wip_count:=v_opening_wip_count+1;
    end loop;
  end if;

  if jsonb_array_length(v_stock_out)>0 then
    for r in select * from jsonb_to_recordset(v_stock_out) as x(item_type text,item_id uuid,wip_id uuid,qty numeric,unit text,category text,target_division_id uuid,notes text) loop
      perform public.barapp_post_stock_out_v2(
        r.item_type,
        case when r.item_type='material' then r.item_id else null end,
        case when r.item_type='wip' then r.wip_id else null end,
        r.qty,trim(r.unit),r.category,p_target_date,r.target_division_id,
        nullif(trim(coalesce(r.notes,'')),'')
      );
      v_stock_out_count:=v_stock_out_count+1;
    end loop;
  end if;

  if jsonb_array_length(v_production)>0 then
    v_production_count:=public.cogs_record_production_batch(p_division_id,p_target_date,v_production,nullif(trim(coalesce(p_payload->>'production_notes','')),''));
  end if;

  if jsonb_array_length(v_sales)>0 then
    v_sales_count:=public.cogs_record_menu_sales_batch(p_division_id,p_target_date,v_sales,nullif(trim(coalesce(p_payload->>'sales_notes','')),''));
  end if;

  if jsonb_array_length(v_supplies)>0 then
    v_supplies_id:=public.barapp_supplies_save_so(p_division_id,p_target_date,v_supplies,nullif(trim(coalesce(p_payload->>'supplies_notes','')),''));
  end if;

  if jsonb_array_length(v_daily)>0 then
    v_daily_id:=public.cogs_save_daily_so(p_division_id,p_target_date,
      (select coalesce(jsonb_agg(jsonb_build_object('type',x.item_type,'id',x.item_id,'counted_qty_base',x.qty) order by x.item_type,x.item_id),'[]'::jsonb)
       from jsonb_to_recordset(v_daily) as x(item_id uuid,item_type text,qty numeric)),
      nullif(trim(coalesce(p_payload->>'daily_so_notes','')),''));
  end if;

  v_hash:=md5(jsonb_build_object('daily_so',v_daily,'sales',v_sales,'stock_in',v_stock_in,'opening_wip',v_opening_wip,'stock_out',v_stock_out,'production',v_production,'supplies',v_supplies)->>'dummy');
  -- Canonical hash of the transaction-bearing payload; catches the same file even if downloaded again.
  v_hash:=md5(jsonb_build_object('daily_so',v_daily,'sales',v_sales,'stock_in',v_stock_in,'opening_wip',v_opening_wip,'stock_out',v_stock_out,'production',v_production,'supplies',v_supplies)::text);
  v_summary:=jsonb_build_object(
    'daily_so',jsonb_array_length(v_daily),'sales',v_sales_count,'stock_in',v_stock_in_count,
    'opening_wip',v_opening_wip_count,'stock_out',v_stock_out_count,'production',v_production_count,
    'supplies',jsonb_array_length(v_supplies),'daily_so_id',v_daily_id,'supplies_so_id',v_supplies_id
  );
  insert into public.barapp_closing_template_imports(template_id,outlet_id,division_id,target_date,payload_hash,imported_by,summary)
  values(p_template_id,v_outlet_id,p_division_id,p_target_date,v_hash,auth.uid(),v_summary)
  returning id into v_import_id;
  insert into public.audit_log(actor,actor_email,action,table_name,record_id,new_data,reason)
  values(auth.uid(),nullif(auth.jwt()->>'email',''),'CLOSING_TEMPLATE_IMPORT','barapp_closing_template_imports',v_import_id::text,
    jsonb_build_object('division_id',p_division_id,'target_date',p_target_date,'template_id',p_template_id,'summary',v_summary),null);
  return jsonb_build_object('import_id',v_import_id,'target_date',p_target_date,'summary',v_summary);
end;
$function$

revoke all on function public.barapp_closing_import_template(uuid,date,uuid,jsonb) from public, anon;
grant execute on function public.barapp_closing_import_template(uuid,date,uuid,jsonb) to authenticated;
