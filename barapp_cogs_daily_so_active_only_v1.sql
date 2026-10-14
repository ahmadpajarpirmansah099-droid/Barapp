-- Barapp COGS: exclude inactive materials and WIP from new Daily SO / stock position.
-- Existing submitted SO snapshots remain untouched.
create or replace function public.cogs_get_stock_position(p_division_id uuid,p_as_of date)
returns table(component_type text,component_id uuid,component_name text,unit text,expected_qty_base numeric,unit_cost numeric,cost_source text)
language plpgsql security definer set search_path=public
as $$
begin
 perform public.cogs_assert_ops_division(p_division_id);
 return query
 select 'material'::text,i.id,i.name,i.base_unit,public.cogs_expected_material_qty(i.id,p_as_of),
  case when coalesce(i.last_purchase_price_per_base,0)>0 then i.last_purchase_price_per_base else nullif(i.reference_price_per_base,0) end,
  case when coalesce(i.last_purchase_price_per_base,0)>0 then 'purchase'::text when coalesce(i.reference_price_per_base,0)>0 then 'reference'::text else 'unknown'::text end
 from public.barapp_items i
 where i.division_id=p_division_id and i.active=true and i.created_at::date<=p_as_of
 union all
 select 'wip'::text,w.id,w.name,w.yield_unit,public.cogs_expected_wip_qty(w.id,p_division_id,p_as_of),co.unit_cost,co.cost_source
 from public.cogs_wip w cross join lateral public.cogs_wip_unit_cost_or_null(w.id) co
 where w.division_id=p_division_id and w.active=true and w.created_at::date<=p_as_of
 order by 1,3;
end;
$$;

create or replace function public.cogs_save_daily_so(p_division_id uuid,p_so_date date,p_lines jsonb,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_so uuid; v_line jsonb; v_type text; v_id uuid; v_count numeric; v_expected numeric; v_name text; v_unit text; v_cost numeric; v_item_count integer; v_seen integer:=0; v_seen_keys text[]:=array[]::text[]; v_key text;
begin
 perform public.cogs_assert_ops_division(p_division_id);
 if p_so_date is null or p_so_date>(now() at time zone 'Asia/Jakarta')::date then raise exception 'COGS_INVALID_SO_DATE'; end if;
 if jsonb_typeof(coalesce(p_lines,'null'::jsonb))<>'array' then raise exception 'COGS_INVALID_SO_LINES'; end if;
 select (select count(*) from public.barapp_items where division_id=p_division_id and active=true and created_at::date<=p_so_date)
 +(select count(*) from public.cogs_wip where division_id=p_division_id and active=true and created_at::date<=p_so_date)
 into v_item_count;
 if jsonb_array_length(p_lines)<>v_item_count then raise exception 'COGS_SO_MUST_COUNT_ALL_ITEMS'; end if;
 if exists(select 1 from public.cogs_daily_so where division_id=p_division_id and so_date=p_so_date and status='submitted') then raise exception 'COGS_SO_ALREADY_SUBMITTED'; end if;
 insert into public.cogs_daily_so(division_id,so_date,notes,created_by) values(p_division_id,p_so_date,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into v_so;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_type:=lower(trim(coalesce(v_line->>'type',''))); v_id:=nullif(trim(coalesce(v_line->>'id','')),'')::uuid; v_count:=nullif(trim(coalesce(v_line->>'counted_qty_base','')),'')::numeric;
  if v_type not in ('material','wip') or v_id is null or v_count is null or v_count<0 then raise exception 'COGS_INVALID_SO_COUNT'; end if;
  v_key:=v_type||':'||v_id::text; if v_key=any(v_seen_keys) then raise exception 'COGS_SO_DUPLICATE_ITEM'; end if; v_seen_keys:=array_append(v_seen_keys,v_key);
  if v_type='material' then
   select i.name,i.base_unit,public.cogs_expected_material_qty(i.id,p_so_date),case when coalesce(i.last_purchase_price_per_base,0)>0 then i.last_purchase_price_per_base else nullif(i.reference_price_per_base,0) end
   into v_name,v_unit,v_expected,v_cost from public.barapp_items i
   where i.id=v_id and i.division_id=p_division_id and i.active=true and i.created_at::date<=p_so_date;
   if not found then raise exception 'COGS_SO_ITEM_INVALID_OR_INACTIVE'; end if;
  else
   select w.name,w.yield_unit,public.cogs_expected_wip_qty(w.id,p_division_id,p_so_date),co.unit_cost
   into v_name,v_unit,v_expected,v_cost from public.cogs_wip w cross join lateral public.cogs_wip_unit_cost_or_null(w.id) co
   where w.id=v_id and w.division_id=p_division_id and w.active=true and w.created_at::date<=p_so_date;
   if not found then raise exception 'COGS_SO_WIP_INVALID_OR_INACTIVE'; end if;
  end if;
  insert into public.cogs_daily_so_lines(so_id,component_type,item_id,component_wip_id,component_name_snapshot,unit_snapshot,expected_qty_base,counted_qty_base,variance_qty_base,unit_cost_snapshot,variance_value_snapshot)
  values(v_so,v_type,case when v_type='material' then v_id end,case when v_type='wip' then v_id end,v_name,v_unit,v_expected,v_count,v_count-v_expected,v_cost,case when v_cost is null then null else (v_count-v_expected)*v_cost end);
  v_seen:=v_seen+1;
 end loop;
 if v_seen<>v_item_count then raise exception 'COGS_SO_MUST_COUNT_ALL_ITEMS'; end if;
 return v_so;
end;
$$;

revoke all on function public.cogs_get_stock_position(uuid,date) from public,anon;
grant execute on function public.cogs_get_stock_position(uuid,date) to authenticated;
revoke all on function public.cogs_save_daily_so(uuid,date,jsonb,text) from public,anon;
grant execute on function public.cogs_save_daily_so(uuid,date,jsonb,text) to authenticated;
