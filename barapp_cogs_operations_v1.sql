-- Barapp COGS Operations V1 (consolidated reference migration)
-- Apply order on a fresh database: barapp_cogs_v1.sql, barapp_cogs_access_fix.sql,
-- barapp_cogs_privileges_fix.sql, then this file LAST in Supabase SQL Editor.
-- This final script replaces unscoped V1 RPCs with division-scoped RPCs, then adds
-- WIP production, menu-sale HPP snapshots, and Daily SO with stock roll-forward.
-- Production project has already received these schema changes; do not rerun needlessly.
-- Direct table writes are revoked; authorized writes go through authenticated admin RPCs.

-- Scope recipes to division. Never guess a division for legacy rows: a wrong automatic
-- assignment can expose or mix recipe data across divisions. Map legacy rows explicitly first.
alter table public.cogs_wip add column if not exists division_id uuid references public.divisions(id) on delete restrict;
alter table public.cogs_menus add column if not exists division_id uuid references public.divisions(id) on delete restrict;
do $$ begin
  if exists(select 1 from public.cogs_wip where division_id is null)
     or exists(select 1 from public.cogs_menus where division_id is null) then
    raise exception 'COGS_DIVISION_REQUIRED: assign every legacy WIP/menu row to its correct enabled division before applying this migration';
  end if;
end $$;
alter table public.cogs_wip alter column division_id set not null;
alter table public.cogs_menus alter column division_id set not null;
drop index if exists public.cogs_wip_name_lower_uq;
drop index if exists public.cogs_menus_name_lower_uq;
create unique index if not exists cogs_wip_division_name_lower_uq on public.cogs_wip(division_id,lower(name));
create unique index if not exists cogs_menus_division_name_lower_uq on public.cogs_menus(division_id,lower(name));
create index if not exists cogs_wip_division_idx on public.cogs_wip(division_id);
create index if not exists cogs_menus_division_idx on public.cogs_menus(division_id);

create table if not exists public.cogs_production_batches (
 id uuid primary key default gen_random_uuid(),
 division_id uuid not null references public.divisions(id) on delete restrict,
 wip_id uuid not null references public.cogs_wip(id) on delete restrict,
 wip_name_snapshot text not null, produced_qty numeric not null check(produced_qty>0), yield_unit text not null,
 unit_cost_snapshot numeric not null check(unit_cost_snapshot>=0),
 total_cost_snapshot numeric not null check(total_cost_snapshot>=0),
 cost_source text not null check(cost_source in ('purchase','reference','opening')),
 produced_at date not null default ((now() at time zone 'Asia/Jakarta')::date),
 notes text, status text not null default 'posted' check(status in ('posted','cancelled')),
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 cancelled_by uuid references auth.users(id) on delete set null, cancelled_at timestamptz
);
-- Keep the existing production-batch constraint compatible with opening WIP stock
-- on databases where this table was created by an earlier version of the migration.
alter table public.cogs_production_batches drop constraint if exists cogs_production_batches_cost_source_check;
alter table public.cogs_production_batches
 add constraint cogs_production_batches_cost_source_check check (cost_source in ('purchase','reference','opening'));
create index if not exists cogs_production_div_date_idx on public.cogs_production_batches(division_id,produced_at);
create index if not exists cogs_production_wip_idx on public.cogs_production_batches(wip_id,produced_at);
alter table public.cogs_production_batches add column if not exists wip_name_snapshot text;
update public.cogs_production_batches b set wip_name_snapshot=w.name from public.cogs_wip w where w.id=b.wip_id and (b.wip_name_snapshot is null or b.wip_name_snapshot='');
update public.cogs_production_batches set wip_name_snapshot='WIP' where wip_name_snapshot is null or wip_name_snapshot='';
alter table public.cogs_production_batches alter column wip_name_snapshot set not null;

create table if not exists public.cogs_production_inputs (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.cogs_production_batches(id) on delete cascade,
 component_type text not null check(component_type in ('material','wip')),
 item_id uuid references public.barapp_items(id) on delete restrict,
 component_wip_id uuid references public.cogs_wip(id) on delete restrict,
 qty_input numeric not null check(qty_input>0), unit_input text not null, qty_base numeric not null check(qty_base>0),
 unit_cost_snapshot numeric not null check(unit_cost_snapshot>=0), total_cost_snapshot numeric not null check(total_cost_snapshot>=0),
 constraint cogs_production_input_component_ck check(
  (component_type='material' and item_id is not null and component_wip_id is null) or
  (component_type='wip' and item_id is null and component_wip_id is not null))
);
create index if not exists cogs_production_inputs_batch_idx on public.cogs_production_inputs(batch_id);
create index if not exists cogs_production_inputs_item_idx on public.cogs_production_inputs(item_id);
create index if not exists cogs_production_inputs_wip_idx on public.cogs_production_inputs(component_wip_id);

create table if not exists public.cogs_menu_sales (
 id uuid primary key default gen_random_uuid(), division_id uuid not null references public.divisions(id) on delete restrict,
 menu_id uuid not null references public.cogs_menus(id) on delete restrict, menu_name_snapshot text not null,
 qty numeric not null check(qty>0), selling_price_snapshot numeric not null check(selling_price_snapshot>=0),
 unit_hpp_snapshot numeric not null check(unit_hpp_snapshot>=0), total_hpp_snapshot numeric not null check(total_hpp_snapshot>=0),
 gross_sales_snapshot numeric not null check(gross_sales_snapshot>=0),
 cost_source text not null check(cost_source in ('purchase','reference')),
 sold_at date not null default ((now() at time zone 'Asia/Jakarta')::date), notes text,
 status text not null default 'posted' check(status in ('posted','cancelled')),
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 cancelled_by uuid references auth.users(id) on delete set null, cancelled_at timestamptz
);
create index if not exists cogs_menu_sales_div_date_idx on public.cogs_menu_sales(division_id,sold_at);
create index if not exists cogs_menu_sales_menu_idx on public.cogs_menu_sales(menu_id,sold_at);

create table if not exists public.cogs_menu_sales_lines (
 id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.cogs_menu_sales(id) on delete cascade,
 component_type text not null check(component_type in ('material','wip')),
 item_id uuid references public.barapp_items(id) on delete restrict,
 component_wip_id uuid references public.cogs_wip(id) on delete restrict,
 qty_input numeric not null check(qty_input>0), unit_input text not null, qty_base numeric not null check(qty_base>0),
 unit_cost_snapshot numeric not null check(unit_cost_snapshot>=0), total_cost_snapshot numeric not null check(total_cost_snapshot>=0),
 constraint cogs_menu_sales_line_component_ck check(
  (component_type='material' and item_id is not null and component_wip_id is null) or
  (component_type='wip' and item_id is null and component_wip_id is not null))
);
create index if not exists cogs_menu_sales_lines_sale_idx on public.cogs_menu_sales_lines(sale_id);
create index if not exists cogs_menu_sales_lines_item_idx on public.cogs_menu_sales_lines(item_id);
create index if not exists cogs_menu_sales_lines_wip_idx on public.cogs_menu_sales_lines(component_wip_id);

create table if not exists public.cogs_daily_so (
 id uuid primary key default gen_random_uuid(), division_id uuid not null references public.divisions(id) on delete restrict,
 so_date date not null, notes text, status text not null default 'submitted' check(status in ('submitted','void')),
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 submitted_at timestamptz not null default now(), voided_by uuid references auth.users(id) on delete set null, voided_at timestamptz
);
create index if not exists cogs_daily_so_div_date_idx on public.cogs_daily_so(division_id,so_date desc);
create unique index if not exists cogs_daily_so_one_submitted_uq on public.cogs_daily_so(division_id,so_date) where status='submitted';

create table if not exists public.cogs_daily_so_lines (
 id uuid primary key default gen_random_uuid(), so_id uuid not null references public.cogs_daily_so(id) on delete cascade,
 component_type text not null check(component_type in ('material','wip')),
 item_id uuid references public.barapp_items(id) on delete restrict,
 component_wip_id uuid references public.cogs_wip(id) on delete restrict,
 component_name_snapshot text not null, unit_snapshot text not null, expected_qty_base numeric not null,
 counted_qty_base numeric not null check(counted_qty_base>=0), variance_qty_base numeric not null,
 unit_cost_snapshot numeric check(unit_cost_snapshot is null or unit_cost_snapshot>=0), variance_value_snapshot numeric,
 constraint cogs_daily_so_line_component_ck check(
  (component_type='material' and item_id is not null and component_wip_id is null) or
  (component_type='wip' and item_id is null and component_wip_id is not null))
);
create index if not exists cogs_daily_so_lines_so_idx on public.cogs_daily_so_lines(so_id);

alter table public.cogs_production_batches enable row level security;
alter table public.cogs_production_inputs enable row level security;
alter table public.cogs_menu_sales enable row level security;
alter table public.cogs_menu_sales_lines enable row level security;
alter table public.cogs_daily_so enable row level security;
alter table public.cogs_daily_so_lines enable row level security;

create or replace function public.cogs_ops_can_access_division(p_division_id uuid)
returns boolean language sql stable security definer set search_path=public,auth
as $
 select auth.uid() is not null
   and exists (
    select 1
    from public.divisions d
    where d.id=p_division_id and d.has_cogs=true
      and (
       coalesce(public.app_role(),'')='dev'
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
          or (public.division_module_enabled(d.id,'cogs_production')
             and (public.has_perm('inventory.inbound.manage') or public.has_perm('inventory.manage')))
        )
        and (
          coalesce(public.app_role(),'') in ('hr','legacy_admin')
          or (coalesce(public.app_role(),'')='div_admin' and public.can_access_scope(d.outlet_id,d.id))
        )
       )
      )
   );
$;
revoke all on function public.cogs_ops_can_access_division(uuid) from public,anon;
grant execute on function public.cogs_ops_can_access_division(uuid) to authenticated;

create or replace function public.cogs_assert_ops_division(p_division_id uuid)
returns void language plpgsql security definer set search_path=public,auth
as $$
begin
 if auth.uid() is null or coalesce(public.app_role(),'') not in ('dev','hr','div_admin','legacy_admin') then raise exception 'COGS_ADMIN_ONLY' using errcode='42501'; end if;
 if not public.cogs_ops_can_access_division(p_division_id) then raise exception 'COGS_DIVISION_FORBIDDEN' using errcode='42501'; end if;
end;
$$;
revoke all on function public.cogs_assert_ops_division(uuid) from public,anon,authenticated;

-- Table-read authorization must respect both the enabled module and the user's
-- feature permission. The frontend loads several COGS datasets together, so each
-- entity allows the specific related modules that genuinely need to read it.
create or replace function public.cogs_ops_can_read_entity(
 p_division_id uuid,p_entity text
) returns boolean
language plpgsql stable security definer set search_path=public,auth
as $barapp_read_guard$
begin
 if auth.uid() is null or not public.cogs_ops_can_access_division(p_division_id) then
  return false;
 end if;
 case p_entity
  when 'wip' then
   return
    (public.division_module_enabled(p_division_id,'cogs_wip') and (public.has_perm('cogs.wip.view') or public.has_perm('cogs.wip.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_production') and (public.has_perm('cogs.production.view') or public.has_perm('cogs.production.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_menu') and (public.has_perm('cogs.menu.view') or public.has_perm('cogs.menu.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_sales') and (public.has_perm('cogs.sales.view') or public.has_perm('cogs.sales.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_daily_so') and (public.has_perm('cogs.daily_so.system') or public.has_perm('cogs.daily_so.difference') or public.has_perm('cogs.daily_so.edit')))
    or (public.division_module_enabled(p_division_id,'cogs_production') and (public.has_perm('inventory.inbound.manage') or public.has_perm('inventory.manage')));
  when 'wip_recipe' then
   return
    (public.division_module_enabled(p_division_id,'cogs_wip') and (public.has_perm('cogs.wip.view') or public.has_perm('cogs.wip.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_production') and (public.has_perm('cogs.production.view') or public.has_perm('cogs.production.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_menu') and (public.has_perm('cogs.menu.view') or public.has_perm('cogs.menu.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_sales') and (public.has_perm('cogs.sales.view') or public.has_perm('cogs.sales.manage')));
  when 'menus' then
   return
    (public.division_module_enabled(p_division_id,'cogs_menu') and (public.has_perm('cogs.menu.view') or public.has_perm('cogs.menu.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_sales') and (public.has_perm('cogs.sales.view') or public.has_perm('cogs.sales.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_daily_so') and (public.has_perm('cogs.daily_so.system') or public.has_perm('cogs.daily_so.difference') or public.has_perm('cogs.daily_so.edit')));
  when 'menu_recipe' then
   return
    (public.division_module_enabled(p_division_id,'cogs_menu') and (public.has_perm('cogs.menu.view') or public.has_perm('cogs.menu.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_sales') and (public.has_perm('cogs.sales.view') or public.has_perm('cogs.sales.manage')));
  when 'production' then
   return
    (public.division_module_enabled(p_division_id,'cogs_production') and (public.has_perm('cogs.production.view') or public.has_perm('cogs.production.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_daily_so') and (public.has_perm('cogs.daily_so.system') or public.has_perm('cogs.daily_so.difference') or public.has_perm('cogs.daily_so.edit')));
  when 'opening_wip' then
   return public.division_module_enabled(p_division_id,'cogs_production')
    and (public.has_perm('inventory.inbound.manage') or public.has_perm('inventory.manage') or public.has_perm('cogs.production.manage'));
  when 'production_inputs' then
   return public.division_module_enabled(p_division_id,'cogs_production')
    and (public.has_perm('cogs.production.view') or public.has_perm('cogs.production.manage'));
  when 'sales' then
   return
    (public.division_module_enabled(p_division_id,'cogs_sales') and (public.has_perm('cogs.sales.view') or public.has_perm('cogs.sales.manage')))
    or (public.division_module_enabled(p_division_id,'cogs_daily_so') and (public.has_perm('cogs.daily_so.system') or public.has_perm('cogs.daily_so.difference') or public.has_perm('cogs.daily_so.edit')));
  when 'sales_lines' then
   return public.division_module_enabled(p_division_id,'cogs_sales')
    and (public.has_perm('cogs.sales.view') or public.has_perm('cogs.sales.manage'));
  when 'daily_so' then
   return public.division_module_enabled(p_division_id,'cogs_daily_so')
    and (public.has_perm('cogs.daily_so.system') or public.has_perm('cogs.daily_so.difference') or public.has_perm('cogs.daily_so.edit'));
  else
   return false;
 end case;
end;
$barapp_read_guard$;
revoke all on function public.cogs_ops_can_read_entity(uuid,text) from public,anon;
grant execute on function public.cogs_ops_can_read_entity(uuid,text) to authenticated;

drop policy if exists cogs_wip_select_admin on public.cogs_wip;
create policy cogs_wip_select_admin on public.cogs_wip for select to authenticated using(public.cogs_ops_can_read_entity(division_id,'wip'));
drop policy if exists cogs_wip_lines_select_admin on public.cogs_wip_recipe_lines;
create policy cogs_wip_lines_select_admin on public.cogs_wip_recipe_lines for select to authenticated
using(exists(select 1 from public.cogs_wip w where w.id=wip_id and public.cogs_ops_can_read_entity(w.division_id,'wip_recipe')));
drop policy if exists cogs_menus_select_admin on public.cogs_menus;
create policy cogs_menus_select_admin on public.cogs_menus for select to authenticated using(public.cogs_ops_can_read_entity(division_id,'menus'));
drop policy if exists cogs_menu_lines_select_admin on public.cogs_menu_recipe_lines;
create policy cogs_menu_lines_select_admin on public.cogs_menu_recipe_lines for select to authenticated
using(exists(select 1 from public.cogs_menus m where m.id=menu_id and public.cogs_ops_can_read_entity(m.division_id,'menu_recipe')));

drop policy if exists cogs_production_select_admin on public.cogs_production_batches;
create policy cogs_production_select_admin on public.cogs_production_batches for select to authenticated using((cost_source='opening' and public.cogs_ops_can_read_entity(division_id,'opening_wip')) or public.cogs_ops_can_read_entity(division_id,'production'));
drop policy if exists cogs_production_inputs_select_admin on public.cogs_production_inputs;
create policy cogs_production_inputs_select_admin on public.cogs_production_inputs for select to authenticated
using(exists(select 1 from public.cogs_production_batches b where b.id=batch_id and public.cogs_ops_can_read_entity(b.division_id,'production_inputs')));
drop policy if exists cogs_menu_sales_select_admin on public.cogs_menu_sales;
create policy cogs_menu_sales_select_admin on public.cogs_menu_sales for select to authenticated using(public.cogs_ops_can_read_entity(division_id,'sales'));
drop policy if exists cogs_menu_sales_lines_select_admin on public.cogs_menu_sales_lines;
create policy cogs_menu_sales_lines_select_admin on public.cogs_menu_sales_lines for select to authenticated
using(exists(select 1 from public.cogs_menu_sales s where s.id=sale_id and public.cogs_ops_can_read_entity(s.division_id,'sales_lines')));
drop policy if exists cogs_daily_so_select_admin on public.cogs_daily_so;
create policy cogs_daily_so_select_admin on public.cogs_daily_so for select to authenticated using(public.cogs_ops_can_read_entity(division_id,'daily_so'));
drop policy if exists cogs_daily_so_lines_select_admin on public.cogs_daily_so_lines;
create policy cogs_daily_so_lines_select_admin on public.cogs_daily_so_lines for select to authenticated
using(exists(select 1 from public.cogs_daily_so s where s.id=so_id and public.cogs_ops_can_read_entity(s.division_id,'daily_so')));

revoke all on public.cogs_production_batches,public.cogs_production_inputs,public.cogs_menu_sales,public.cogs_menu_sales_lines,public.cogs_daily_so,public.cogs_daily_so_lines from public,anon,authenticated;
grant select on public.cogs_production_batches,public.cogs_production_inputs,public.cogs_menu_sales,public.cogs_menu_sales_lines,public.cogs_daily_so,public.cogs_daily_so_lines to authenticated;

-- Price calculation helpers are internal to security-definer RPCs, not exposed to browser clients.
create or replace function public.cogs_wip_unit_cost(p_wip_id uuid,p_stack uuid[] default array[]::uuid[])
returns table(unit_cost numeric,cost_source text)
language plpgsql security definer set search_path=public
as $$
declare v_yield numeric; v_division uuid; v_component_division uuid; v_total numeric:=0; v_last numeric; v_ref numeric; v_price numeric; v_src text:='purchase'; v_child_cost numeric; v_child_src text; v_line record; v_has_lines boolean:=false;
begin
 if p_wip_id=any(coalesce(p_stack,array[]::uuid[])) then raise exception 'COGS_WIP_CYCLE'; end if;
 select yield_qty,division_id into v_yield,v_division from public.cogs_wip where id=p_wip_id and active=true;
 if not found or coalesce(v_yield,0)<=0 then raise exception 'COGS_WIP_NOT_ACTIVE'; end if;
 for v_line in select * from public.cogs_wip_recipe_lines where wip_id=p_wip_id loop
  v_has_lines:=true;
  if v_line.component_type='material' then
   select last_purchase_price_per_base,reference_price_per_base,division_id into v_last,v_ref,v_component_division from public.barapp_items where id=v_line.item_id and active=true;
   if not found then raise exception 'COGS_MATERIAL_NOT_ACTIVE'; end if;
   if v_component_division is distinct from v_division then raise exception 'COGS_COMPONENT_DIVISION_MISMATCH'; end if;
   v_price:=case when coalesce(v_last,0)>0 then v_last else nullif(v_ref,0) end;
   if v_price is null then raise exception 'COGS_PRICE_MISSING'; end if;
   if coalesce(v_last,0)<=0 then v_src:='reference'; end if;
   v_total:=v_total+v_line.qty_base*v_price;
  else
   select division_id into v_component_division from public.cogs_wip where id=v_line.component_wip_id and active=true;
   if not found then raise exception 'COGS_WIP_NOT_ACTIVE'; end if;
   if v_component_division is distinct from v_division then raise exception 'COGS_COMPONENT_DIVISION_MISMATCH'; end if;
   select c.unit_cost,c.cost_source into v_child_cost,v_child_src from public.cogs_wip_unit_cost(v_line.component_wip_id,coalesce(p_stack,array[]::uuid[])||p_wip_id) c;
   v_total:=v_total+v_line.qty_base*v_child_cost;
   if v_child_src='reference' then v_src:='reference'; end if;
  end if;
 end loop;
 if not v_has_lines then raise exception 'COGS_RECIPE_EMPTY'; end if;
 return query select v_total/v_yield,v_src;
end;
$$;
create or replace function public.cogs_wip_unit_cost_or_null(p_wip_id uuid)
returns table(unit_cost numeric,cost_source text) language plpgsql security definer set search_path=public
as $$ begin return query select c.unit_cost,c.cost_source from public.cogs_wip_unit_cost(p_wip_id,array[]::uuid[]) c;
exception when others then return query select null::numeric,'unknown'::text; end; $$;
create or replace function public.cogs_menu_unit_cost(p_menu_id uuid)
returns table(unit_hpp numeric,selling_price numeric,cost_source text)
language plpgsql security definer set search_path=public
as $$
declare v_menu record; v_line record; v_last numeric; v_ref numeric; v_price numeric; v_component_division uuid; v_child_cost numeric; v_child_src text; v_total numeric:=0; v_src text:='purchase'; v_has_lines boolean:=false;
begin
 select * into v_menu from public.cogs_menus where id=p_menu_id and active=true;
 if not found then raise exception 'COGS_MENU_NOT_ACTIVE'; end if;
 for v_line in select * from public.cogs_menu_recipe_lines where menu_id=p_menu_id loop
  v_has_lines:=true;
  if v_line.component_type='material' then
   select last_purchase_price_per_base,reference_price_per_base,division_id into v_last,v_ref,v_component_division from public.barapp_items where id=v_line.item_id and active=true;
   if not found then raise exception 'COGS_MATERIAL_NOT_ACTIVE'; end if;
   if v_component_division is distinct from v_menu.division_id then raise exception 'COGS_COMPONENT_DIVISION_MISMATCH'; end if;
   v_price:=case when coalesce(v_last,0)>0 then v_last else nullif(v_ref,0) end;
   if v_price is null then raise exception 'COGS_PRICE_MISSING'; end if;
   if coalesce(v_last,0)<=0 then v_src:='reference'; end if;
   v_total:=v_total+v_line.qty_base*v_price;
  else
   select division_id into v_component_division from public.cogs_wip where id=v_line.component_wip_id and active=true;
   if not found then raise exception 'COGS_WIP_NOT_ACTIVE'; end if;
   if v_component_division is distinct from v_menu.division_id then raise exception 'COGS_COMPONENT_DIVISION_MISMATCH'; end if;
   select c.unit_cost,c.cost_source into v_child_cost,v_child_src from public.cogs_wip_unit_cost(v_line.component_wip_id,array[]::uuid[]) c;
   v_total:=v_total+v_line.qty_base*v_child_cost;
   if v_child_src='reference' then v_src:='reference'; end if;
  end if;
 end loop;
 if not v_has_lines then raise exception 'COGS_RECIPE_EMPTY'; end if;
 return query select v_total,v_menu.selling_price,v_src;
end;
$$;
revoke all on function public.cogs_wip_unit_cost(uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.cogs_wip_unit_cost_or_null(uuid) from public,anon,authenticated;
revoke all on function public.cogs_menu_unit_cost(uuid) from public,anon,authenticated;

create or replace function public.cogs_expected_material_qty(p_item_id uuid,p_as_of date)
returns numeric language plpgsql stable security definer set search_path=public
as $$
declare v_div uuid; v_cut date; v_base numeric;
begin
 select division_id into v_div from public.barapp_items where id=p_item_id;
 if not found then return 0; end if;
 select s.so_date,l.counted_qty_base into v_cut,v_base
 from public.cogs_daily_so s join public.cogs_daily_so_lines l on l.so_id=s.id
 where s.division_id=v_div and s.status='submitted' and s.so_date<p_as_of
 and l.component_type='material' and l.item_id=p_item_id order by s.so_date desc limit 1;
 if found then
  return coalesce(v_base,0)
   +coalesce((select sum(i.qty_base) from public.barapp_stock_in i where i.item_id=p_item_id and i.status='posted' and i.received_at>v_cut and i.received_at<=p_as_of),0)
   -coalesce((select sum(r.qty_base) from public.barapp_stock_returns r where r.item_id=p_item_id and r.status='posted' and r.returned_at>v_cut and r.returned_at<=p_as_of),0)
   -coalesce((select sum(l.qty_base) from public.cogs_production_inputs l join public.cogs_production_batches b on b.id=l.batch_id where l.component_type='material' and l.item_id=p_item_id and b.division_id=v_div and b.status='posted' and b.produced_at>v_cut and b.produced_at<=p_as_of),0)
   -coalesce((select sum(l.qty_base) from public.cogs_menu_sales_lines l join public.cogs_menu_sales s on s.id=l.sale_id where l.component_type='material' and l.item_id=p_item_id and s.division_id=v_div and s.status='posted' and s.sold_at>v_cut and s.sold_at<=p_as_of),0)
   -coalesce((select sum(o.qty_base) from public.barapp_stock_out o where o.item_type='material' and o.item_id=p_item_id and o.from_division_id=v_div and o.status='posted' and o.out_date>v_cut and o.out_date<=p_as_of),0)
   +coalesce((select sum(o.qty_base) from public.barapp_stock_out o where o.item_type='material' and o.target_item_id=p_item_id and o.to_division_id=v_div and o.category='Move' and o.status='posted' and o.out_date>v_cut and o.out_date<=p_as_of),0);
 end if;
 return coalesce((select sum(i.qty_base) from public.barapp_stock_in i where i.item_id=p_item_id and i.status='posted' and i.received_at<=p_as_of),0)
  -coalesce((select sum(r.qty_base) from public.barapp_stock_returns r where r.item_id=p_item_id and r.status='posted' and r.returned_at<=p_as_of),0)
  -coalesce((select sum(l.qty_base) from public.cogs_production_inputs l join public.cogs_production_batches b on b.id=l.batch_id where l.component_type='material' and l.item_id=p_item_id and b.division_id=v_div and b.status='posted' and b.produced_at<=p_as_of),0)
  -coalesce((select sum(l.qty_base) from public.cogs_menu_sales_lines l join public.cogs_menu_sales s on s.id=l.sale_id where l.component_type='material' and l.item_id=p_item_id and s.division_id=v_div and s.status='posted' and s.sold_at<=p_as_of),0)
  -coalesce((select sum(o.qty_base) from public.barapp_stock_out o where o.item_type='material' and o.item_id=p_item_id and o.from_division_id=v_div and o.status='posted' and o.out_date<=p_as_of),0)
  +coalesce((select sum(o.qty_base) from public.barapp_stock_out o where o.item_type='material' and o.target_item_id=p_item_id and o.to_division_id=v_div and o.category='Move' and o.status='posted' and o.out_date<=p_as_of),0);
end; $$;
create or replace function public.cogs_expected_wip_qty(p_wip_id uuid,p_division_id uuid,p_as_of date)
returns numeric language plpgsql stable security definer set search_path=public
as $$
declare v_cut date; v_base numeric;
begin
 select s.so_date,l.counted_qty_base into v_cut,v_base from public.cogs_daily_so s join public.cogs_daily_so_lines l on l.so_id=s.id
 where s.division_id=p_division_id and s.status='submitted' and s.so_date<p_as_of and l.component_type='wip' and l.component_wip_id=p_wip_id order by s.so_date desc limit 1;
 if found then
  return coalesce(v_base,0)
   +coalesce((select sum(b.produced_qty) from public.cogs_production_batches b where b.wip_id=p_wip_id and b.division_id=p_division_id and b.status='posted' and b.produced_at>v_cut and b.produced_at<=p_as_of),0)
   -coalesce((select sum(l.qty_base) from public.cogs_production_inputs l join public.cogs_production_batches b on b.id=l.batch_id where l.component_type='wip' and l.component_wip_id=p_wip_id and b.division_id=p_division_id and b.status='posted' and b.produced_at>v_cut and b.produced_at<=p_as_of),0)
   -coalesce((select sum(l.qty_base) from public.cogs_menu_sales_lines l join public.cogs_menu_sales s on s.id=l.sale_id where l.component_type='wip' and l.component_wip_id=p_wip_id and s.division_id=p_division_id and s.status='posted' and s.sold_at>v_cut and s.sold_at<=p_as_of),0)
   -coalesce((select sum(o.qty_base) from public.barapp_stock_out o where o.item_type='wip' and o.wip_id=p_wip_id and o.from_division_id=p_division_id and o.status='posted' and o.out_date>v_cut and o.out_date<=p_as_of),0)
   +coalesce((select sum(o.qty_base) from public.barapp_stock_out o where o.item_type='wip' and o.target_wip_id=p_wip_id and o.to_division_id=p_division_id and o.category='Move' and o.status='posted' and o.out_date>v_cut and o.out_date<=p_as_of),0);
 end if;
 return coalesce((select sum(b.produced_qty) from public.cogs_production_batches b where b.wip_id=p_wip_id and b.division_id=p_division_id and b.status='posted' and b.produced_at<=p_as_of),0)
  -coalesce((select sum(l.qty_base) from public.cogs_production_inputs l join public.cogs_production_batches b on b.id=l.batch_id where l.component_type='wip' and l.component_wip_id=p_wip_id and b.division_id=p_division_id and b.status='posted' and b.produced_at<=p_as_of),0)
  -coalesce((select sum(l.qty_base) from public.cogs_menu_sales_lines l join public.cogs_menu_sales s on s.id=l.sale_id where l.component_type='wip' and l.component_wip_id=p_wip_id and s.division_id=p_division_id and s.status='posted' and s.sold_at<=p_as_of),0)
  -coalesce((select sum(o.qty_base) from public.barapp_stock_out o where o.item_type='wip' and o.wip_id=p_wip_id and o.from_division_id=p_division_id and o.status='posted' and o.out_date<=p_as_of),0)
  +coalesce((select sum(o.qty_base) from public.barapp_stock_out o where o.item_type='wip' and o.target_wip_id=p_wip_id and o.to_division_id=p_division_id and o.category='Move' and o.status='posted' and o.out_date<=p_as_of),0);
end; $$;
revoke all on function public.cogs_expected_material_qty(uuid,date) from public,anon,authenticated;
revoke all on function public.cogs_expected_wip_qty(uuid,uuid,date) from public,anon,authenticated;

-- Queryable stock position for authorized COGS division only.
create or replace function public.cogs_get_stock_position(p_division_id uuid,p_as_of date)
returns table(component_type text,component_id uuid,component_name text,unit text,expected_qty_base numeric,unit_cost numeric,cost_source text)
language plpgsql security definer set search_path=public
as $$
begin
 perform public.cogs_assert_division_module(p_division_id, 'cogs_daily_so');
 if not (public.has_perm('cogs.daily_so.system') or public.has_perm('cogs.daily_so.difference') or public.has_perm('cogs.daily_so.edit')) then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_as_of is null or p_as_of>(now() at time zone 'Asia/Jakarta')::date then raise exception 'COGS_INVALID_SO_DATE'; end if;
 return query
 select 'material'::text,i.id,i.name,i.base_unit,public.cogs_expected_material_qty(i.id,p_as_of),
  case when coalesce(i.last_purchase_price_per_base,0)>0 then i.last_purchase_price_per_base else nullif(i.reference_price_per_base,0) end,
  case when coalesce(i.last_purchase_price_per_base,0)>0 then 'purchase'::text when coalesce(i.reference_price_per_base,0)>0 then 'reference'::text else 'unknown'::text end
 from public.barapp_items i where i.division_id=p_division_id and i.active=true and i.created_at::date<=p_as_of
 union all
 select 'wip'::text,w.id,w.name,w.yield_unit,public.cogs_expected_wip_qty(w.id,p_division_id,p_as_of),co.unit_cost,co.cost_source
 from public.cogs_wip w cross join lateral public.cogs_wip_unit_cost_or_null(w.id) co where w.division_id=p_division_id and w.active=true and w.created_at::date<=p_as_of and public.division_module_enabled(p_division_id,'cogs_wip')
 order by 1,3;
end; $$;
revoke all on function public.cogs_get_stock_position(uuid,date) from public,anon;
grant execute on function public.cogs_get_stock_position(uuid,date) to authenticated;

-- Mutation functions below enforce division, component-unit, and active/price checks and save immutable snapshots.
create or replace function public.cogs_record_production(p_division_id uuid,p_wip_id uuid,p_produced_qty numeric,p_produced_at date,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_yield numeric; v_unit text; v_wip_name text; v_unit_cost numeric; v_total numeric; v_source text; v_batch uuid; v_line record; v_last numeric; v_ref numeric; v_price numeric; v_child_cost numeric;
begin
 perform public.cogs_assert_division_module(p_division_id, 'cogs_production');
 if not public.has_perm('cogs.production.manage') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_produced_at is null or p_produced_at>(now() at time zone 'Asia/Jakarta')::date then raise exception 'COGS_INVALID_PRODUCTION_DATE'; end if;
 if p_produced_qty is null or p_produced_qty<=0 then raise exception 'COGS_INVALID_PRODUCTION_QTY'; end if;
 select yield_qty,yield_unit,name into v_yield,v_unit,v_wip_name from public.cogs_wip where id=p_wip_id and active=true and division_id=p_division_id;
 if not found then raise exception 'COGS_WIP_NOT_ACTIVE_OR_WRONG_DIVISION'; end if;
 select c.unit_cost,c.cost_source into v_unit_cost,v_source from public.cogs_wip_unit_cost(p_wip_id,array[]::uuid[]) c;
 v_total:=v_unit_cost*p_produced_qty;
 insert into public.cogs_production_batches(division_id,wip_id,wip_name_snapshot,produced_qty,yield_unit,unit_cost_snapshot,total_cost_snapshot,cost_source,produced_at,notes,created_by)
 values(p_division_id,p_wip_id,v_wip_name,p_produced_qty,v_unit,v_unit_cost,v_total,v_source,p_produced_at,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into v_batch;
 for v_line in select * from public.cogs_wip_recipe_lines where wip_id=p_wip_id loop
  if v_line.component_type='material' then
   select last_purchase_price_per_base,reference_price_per_base into v_last,v_ref from public.barapp_items where id=v_line.item_id and active=true and division_id=p_division_id;
   if not found then raise exception 'COGS_MATERIAL_NOT_ACTIVE_IN_DIVISION'; end if;
   v_price:=case when coalesce(v_last,0)>0 then v_last else nullif(v_ref,0) end;
   if v_price is null then raise exception 'COGS_PRICE_MISSING'; end if;
   insert into public.cogs_production_inputs(batch_id,component_type,item_id,qty_input,unit_input,qty_base,unit_cost_snapshot,total_cost_snapshot)
   values(v_batch,'material',v_line.item_id,v_line.qty_input*p_produced_qty/v_yield,v_line.unit_input,v_line.qty_base*p_produced_qty/v_yield,v_price,v_line.qty_base*p_produced_qty/v_yield*v_price);
  else
   select c.unit_cost into v_child_cost from public.cogs_wip_unit_cost(v_line.component_wip_id,array[]::uuid[]) c;
   insert into public.cogs_production_inputs(batch_id,component_type,component_wip_id,qty_input,unit_input,qty_base,unit_cost_snapshot,total_cost_snapshot)
   values(v_batch,'wip',v_line.component_wip_id,v_line.qty_input*p_produced_qty/v_yield,v_line.unit_input,v_line.qty_base*p_produced_qty/v_yield,v_child_cost,v_line.qty_base*p_produced_qty/v_yield*v_child_cost);
  end if;
 end loop;
 return v_batch;
end; $$;

-- Opening WIP stock is a counted starting balance, not a production run:
-- it must never create recipe-input rows or consume raw materials.
create or replace function public.cogs_record_opening_wip_stock(
 p_division_id uuid,p_wip_id uuid,p_qty numeric,p_date date,p_notes text default null
) returns uuid language plpgsql security definer set search_path=public
as $barapp_opening_wip$
declare v_unit text; v_name text; v_batch uuid;
begin
 perform public.cogs_assert_division_module(p_division_id, 'cogs_production');
 if not (public.has_perm('inventory.inbound.manage') or public.has_perm('cogs.production.manage')) then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_date is null or p_date>(now() at time zone 'Asia/Jakarta')::date then
  raise exception 'COGS_INVALID_OPENING_WIP_DATE';
 end if;
 if p_qty is null or p_qty<=0 then raise exception 'COGS_INVALID_OPENING_WIP_QTY'; end if;
 select yield_unit,name into v_unit,v_name
 from public.cogs_wip
 where id=p_wip_id and division_id=p_division_id and active=true;
 if not found then raise exception 'COGS_WIP_NOT_ACTIVE_OR_WRONG_DIVISION'; end if;
 insert into public.cogs_production_batches(
  division_id,wip_id,wip_name_snapshot,produced_qty,yield_unit,
  unit_cost_snapshot,total_cost_snapshot,cost_source,produced_at,notes,created_by
 ) values (
  p_division_id,p_wip_id,v_name,p_qty,v_unit,0,0,'opening',p_date,
  concat_ws(' · ','STOK AWAL WIP (tanpa pemakaian resep)',nullif(trim(coalesce(p_notes,'')),'')),
  auth.uid()
 ) returning id into v_batch;
 return v_batch;
end; $barapp_opening_wip$;

create or replace function public.cogs_update_opening_wip_stock(
 p_batch_id uuid,p_qty numeric,p_date date,p_notes text default null
) returns void language plpgsql security definer set search_path=public
as $barapp_opening_wip$
declare v_division uuid;
begin
 select division_id into v_division
 from public.cogs_production_batches
 where id=p_batch_id and cost_source='opening' and status='posted'
 for update;
 if not found then raise exception 'COGS_OPENING_WIP_NOT_FOUND'; end if;
 perform public.cogs_assert_division_module(v_division, 'cogs_production');
  if not (public.has_perm('inventory.inbound.manage') or public.has_perm('cogs.production.manage')) then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_date is null or p_date>(now() at time zone 'Asia/Jakarta')::date then
  raise exception 'COGS_INVALID_OPENING_WIP_DATE';
 end if;
 if p_qty is null or p_qty<=0 then raise exception 'COGS_INVALID_OPENING_WIP_QTY'; end if;
 update public.cogs_production_batches
 set produced_qty=p_qty,produced_at=p_date,
  notes=concat_ws(' · ','STOK AWAL WIP (tanpa pemakaian resep)',nullif(trim(coalesce(p_notes,'')),''))
 where id=p_batch_id and cost_source='opening' and status='posted';
end; $barapp_opening_wip$;

create or replace function public.cogs_cancel_opening_wip_stock(p_batch_id uuid)
returns void language plpgsql security definer set search_path=public
as $barapp_opening_wip$
declare v_division uuid;
begin
 select division_id into v_division
 from public.cogs_production_batches
 where id=p_batch_id and cost_source='opening' and status='posted'
 for update;
 if not found then raise exception 'COGS_OPENING_WIP_NOT_FOUND'; end if;
 perform public.cogs_assert_division_module(v_division, 'cogs_production');
 if not (public.has_perm('inventory.inbound.manage') or public.has_perm('cogs.production.manage')) then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 update public.cogs_production_batches
 set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now()
 where id=p_batch_id and cost_source='opening' and status='posted';
end; $barapp_opening_wip$;

create or replace function public.cogs_record_menu_sale(p_division_id uuid,p_menu_id uuid,p_qty numeric,p_sold_at date,p_selling_price numeric default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_menu record; v_unit_hpp numeric; v_price numeric; v_source text; v_sale uuid; v_line record; v_last numeric; v_ref numeric; v_component_price numeric; v_child_cost numeric;
begin
 perform public.cogs_assert_division_module(p_division_id, 'cogs_sales');
 if not public.has_perm('cogs.sales.manage') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_sold_at is null or p_sold_at>(now() at time zone 'Asia/Jakarta')::date then raise exception 'COGS_INVALID_SALE_DATE'; end if;
 if p_qty is null or p_qty<=0 then raise exception 'COGS_INVALID_SALE_QTY'; end if;
 select * into v_menu from public.cogs_menus where id=p_menu_id and active=true and division_id=p_division_id;
 if not found then raise exception 'COGS_MENU_NOT_ACTIVE_OR_WRONG_DIVISION'; end if;
 select c.unit_hpp,c.selling_price,c.cost_source into v_unit_hpp,v_price,v_source from public.cogs_menu_unit_cost(p_menu_id) c;
 if p_selling_price is not null then if p_selling_price<0 then raise exception 'COGS_INVALID_SELLING_PRICE'; end if; v_price:=p_selling_price; end if;
 insert into public.cogs_menu_sales(division_id,menu_id,menu_name_snapshot,qty,selling_price_snapshot,unit_hpp_snapshot,total_hpp_snapshot,gross_sales_snapshot,cost_source,sold_at,notes,created_by)
 values(p_division_id,p_menu_id,v_menu.name,p_qty,v_price,v_unit_hpp,v_unit_hpp*p_qty,v_price*p_qty,v_source,p_sold_at,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into v_sale;
 for v_line in select * from public.cogs_menu_recipe_lines where menu_id=p_menu_id loop
  if v_line.component_type='material' then
   select last_purchase_price_per_base,reference_price_per_base into v_last,v_ref from public.barapp_items where id=v_line.item_id and active=true and division_id=p_division_id;
   if not found then raise exception 'COGS_MATERIAL_NOT_ACTIVE_IN_DIVISION'; end if;
   v_component_price:=case when coalesce(v_last,0)>0 then v_last else nullif(v_ref,0) end;
   if v_component_price is null then raise exception 'COGS_PRICE_MISSING'; end if;
   insert into public.cogs_menu_sales_lines(sale_id,component_type,item_id,qty_input,unit_input,qty_base,unit_cost_snapshot,total_cost_snapshot)
   values(v_sale,'material',v_line.item_id,v_line.qty_input*p_qty,v_line.unit_input,v_line.qty_base*p_qty,v_component_price,v_line.qty_base*p_qty*v_component_price);
  else
   select c.unit_cost into v_child_cost from public.cogs_wip_unit_cost(v_line.component_wip_id,array[]::uuid[]) c;
   insert into public.cogs_menu_sales_lines(sale_id,component_type,component_wip_id,qty_input,unit_input,qty_base,unit_cost_snapshot,total_cost_snapshot)
   values(v_sale,'wip',v_line.component_wip_id,v_line.qty_input*p_qty,v_line.unit_input,v_line.qty_base*p_qty,v_child_cost,v_line.qty_base*p_qty*v_child_cost);
  end if;
 end loop;
 return v_sale;
end; $$;

-- Batch RPCs used by the multi-row production and menu-sales forms.
-- An exception on any row aborts the entire call, so a partial batch is never committed.
create or replace function public.cogs_record_production_batch(
 p_division_id uuid,p_produced_at date,p_lines jsonb,p_notes text default null
) returns integer language plpgsql security definer set search_path=public
as $barapp_batch_ops$
declare v_line jsonb; v_wip_id uuid; v_batches numeric; v_yield numeric; v_saved integer:=0; v_seen uuid[]:=array[]::uuid[];
begin
 perform public.cogs_assert_division_module(p_division_id, 'cogs_production');
 if not public.has_perm('cogs.production.manage') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_produced_at is null or p_produced_at>(now() at time zone 'Asia/Jakarta')::date then
  raise exception 'COGS_INVALID_PRODUCTION_DATE';
 end if;
 if jsonb_typeof(coalesce(p_lines,'null'::jsonb))<>'array' then
  raise exception 'COGS_INVALID_PRODUCTION_LINES';
 end if;
 if jsonb_array_length(p_lines)=0 then raise exception 'COGS_INVALID_PRODUCTION_LINES'; end if;
 if jsonb_array_length(p_lines)>200 then raise exception 'COGS_INVALID_PRODUCTION_LINES'; end if;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_wip_id:=nullif(trim(coalesce(v_line->>'wip_id','')),'')::uuid;
  v_batches:=nullif(trim(coalesce(v_line->>'batches','')),'')::numeric;
  if v_wip_id is null or v_batches is null or v_batches<=0 or v_batches<>trunc(v_batches) then
   raise exception 'COGS_INVALID_PRODUCTION_BATCH_LINE';
  end if;
  if v_wip_id=any(v_seen) then raise exception 'COGS_DUPLICATE_WIP_IN_BATCH'; end if;
  v_seen:=array_append(v_seen,v_wip_id);
  select yield_qty into v_yield from public.cogs_wip
   where id=v_wip_id and division_id=p_division_id and active=true;
  if not found or coalesce(v_yield,0)<=0 then raise exception 'COGS_WIP_NOT_ACTIVE_OR_WRONG_DIVISION'; end if;
  perform public.cogs_record_production(p_division_id,v_wip_id,v_batches*v_yield,p_produced_at,p_notes);
  v_saved:=v_saved+1;
 end loop;
 return v_saved;
end; $barapp_batch_ops$;

create or replace function public.cogs_record_menu_sales_batch(
 p_division_id uuid,p_sold_at date,p_lines jsonb,p_notes text default null
) returns integer language plpgsql security definer set search_path=public
as $barapp_batch_ops$
declare v_line jsonb; v_menu_id uuid; v_qty numeric; v_price numeric; v_saved integer:=0; v_seen uuid[]:=array[]::uuid[];
begin
 perform public.cogs_assert_division_module(p_division_id, 'cogs_sales');
 if not public.has_perm('cogs.sales.manage') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_sold_at is null or p_sold_at>(now() at time zone 'Asia/Jakarta')::date then
  raise exception 'COGS_INVALID_SALE_DATE';
 end if;
 if jsonb_typeof(coalesce(p_lines,'null'::jsonb))<>'array' then
  raise exception 'COGS_INVALID_SALE_LINES';
 end if;
 if jsonb_array_length(p_lines)=0 then raise exception 'COGS_INVALID_SALE_LINES'; end if;
 if jsonb_array_length(p_lines)>200 then raise exception 'COGS_TOO_MANY_SALE_LINES'; end if;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_menu_id:=nullif(trim(coalesce(v_line->>'menu_id','')),'')::uuid;
  v_qty:=nullif(trim(coalesce(v_line->>'qty','')),'')::numeric;
  v_price:=nullif(trim(coalesce(v_line->>'selling_price','')),'')::numeric;
  if v_menu_id is null or v_qty is null or v_qty<=0 or (v_price is not null and v_price<0) then
   raise exception 'COGS_INVALID_SALE_LINE';
  end if;
  if v_menu_id=any(v_seen) then raise exception 'COGS_DUPLICATE_MENU_IN_BATCH'; end if;
  v_seen:=array_append(v_seen,v_menu_id);
  perform public.cogs_record_menu_sale(p_division_id,v_menu_id,v_qty,p_sold_at,v_price,p_notes);
  v_saved:=v_saved+1;
 end loop;
 return v_saved;
end; $barapp_batch_ops$;

-- Grant access only after each RPC has been created; earlier placement fails on a fresh DB.
revoke all on function public.cogs_record_opening_wip_stock(uuid,uuid,numeric,date,text) from public,anon;
revoke all on function public.cogs_update_opening_wip_stock(uuid,numeric,date,text) from public,anon;
revoke all on function public.cogs_cancel_opening_wip_stock(uuid) from public,anon;
grant execute on function public.cogs_record_opening_wip_stock(uuid,uuid,numeric,date,text) to authenticated;
grant execute on function public.cogs_update_opening_wip_stock(uuid,numeric,date,text) to authenticated;
grant execute on function public.cogs_cancel_opening_wip_stock(uuid) to authenticated;

revoke all on function public.cogs_record_production_batch(uuid,date,jsonb,text) from public,anon;
revoke all on function public.cogs_record_menu_sales_batch(uuid,date,jsonb,text) from public,anon;
grant execute on function public.cogs_record_production_batch(uuid,date,jsonb,text) to authenticated;
grant execute on function public.cogs_record_menu_sales_batch(uuid,date,jsonb,text) to authenticated;


create or replace function public.cogs_save_daily_so(p_division_id uuid,p_so_date date,p_lines jsonb,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_so uuid; v_line jsonb; v_type text; v_id uuid; v_count numeric; v_expected numeric; v_name text; v_unit text; v_cost numeric; v_item_count integer; v_seen integer:=0; v_seen_keys text[]:=array[]::text[]; v_key text;
begin
 perform public.cogs_assert_division_module(p_division_id, 'cogs_daily_so');
 if not public.has_perm('cogs.daily_so.edit') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_so_date is null or p_so_date>(now() at time zone 'Asia/Jakarta')::date then raise exception 'COGS_INVALID_SO_DATE'; end if;
 if jsonb_typeof(coalesce(p_lines,'null'::jsonb))<>'array' then raise exception 'COGS_INVALID_SO_LINES'; end if;
 select (select count(*) from public.barapp_items where division_id=p_division_id and active=true and coalesce(is_supply,false)=false and created_at::date<=p_so_date)
 +(case when public.division_module_enabled(p_division_id,'cogs_wip') then (select count(*) from public.cogs_wip where division_id=p_division_id and active=true and created_at::date<=p_so_date) else 0 end) into v_item_count;
 if jsonb_array_length(p_lines)<>v_item_count then raise exception 'COGS_SO_MUST_COUNT_ALL_ITEMS'; end if;
 if exists(select 1 from public.cogs_daily_so where division_id=p_division_id and so_date=p_so_date and status='submitted') then raise exception 'COGS_SO_ALREADY_SUBMITTED'; end if;
 insert into public.cogs_daily_so(division_id,so_date,notes,created_by) values(p_division_id,p_so_date,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into v_so;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_type:=lower(trim(coalesce(v_line->>'type',''))); v_id:=nullif(trim(coalesce(v_line->>'id','')),'')::uuid; v_count:=nullif(trim(coalesce(v_line->>'counted_qty_base','')),'')::numeric;
  if v_type not in ('material','wip') or v_id is null or v_count is null or v_count<0 then raise exception 'COGS_INVALID_SO_COUNT'; end if;
  v_key:=v_type||':'||v_id::text; if v_key=any(v_seen_keys) then raise exception 'COGS_SO_DUPLICATE_ITEM'; end if; v_seen_keys:=array_append(v_seen_keys,v_key);
  if v_type='material' then
   select i.name,i.base_unit,public.cogs_expected_material_qty(i.id,p_so_date),case when coalesce(i.last_purchase_price_per_base,0)>0 then i.last_purchase_price_per_base else nullif(i.reference_price_per_base,0) end
   into v_name,v_unit,v_expected,v_cost from public.barapp_items i where i.id=v_id and i.division_id=p_division_id and i.active=true and coalesce(i.is_supply,false)=false and i.created_at::date<=p_so_date;
   if not found then raise exception 'COGS_SO_ITEM_INVALID_OR_INACTIVE'; end if;
  else
   if not public.division_module_enabled(p_division_id,'cogs_wip') then raise exception 'COGS_WIP_MODULE_DISABLED' using errcode='42501'; end if;
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
end; $$;

create or replace function public.cogs_cancel_operation(p_kind text,p_id uuid,p_reason text default null)
returns void language plpgsql security definer set search_path=public
as $$
declare v_division uuid;
begin
 if auth.uid() is null or coalesce(public.app_role(),'') not in ('dev','hr','div_admin','legacy_admin') then raise exception 'COGS_ADMIN_ONLY' using errcode='42501'; end if;
 if lower(p_kind)='production' then
  select division_id into v_division from public.cogs_production_batches where id=p_id and status='posted';
  if not found then raise exception 'COGS_OPERATION_NOT_FOUND'; end if;
  perform public.cogs_assert_division_module(v_division, 'cogs_production');
  if not public.has_perm('cogs.production.manage') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
  update public.cogs_production_batches set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),notes=concat_ws(E'\n',notes,nullif(trim(coalesce(p_reason,'')),'')) where id=p_id and status='posted';
 elsif lower(p_kind)='sale' then
  select division_id into v_division from public.cogs_menu_sales where id=p_id and status='posted';
  if not found then raise exception 'COGS_OPERATION_NOT_FOUND'; end if;
  perform public.cogs_assert_division_module(v_division, 'cogs_sales');
  if not public.has_perm('cogs.sales.manage') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
  update public.cogs_menu_sales set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),notes=concat_ws(E'\n',notes,nullif(trim(coalesce(p_reason,'')),'')) where id=p_id and status='posted';
 elsif lower(p_kind)='daily_so' then
  select division_id into v_division from public.cogs_daily_so where id=p_id and status='submitted';
  if not found then raise exception 'COGS_OPERATION_NOT_FOUND'; end if;
  perform public.cogs_assert_division_module(v_division, 'cogs_daily_so');
  if not public.has_perm('cogs.daily_so.edit') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
  update public.cogs_daily_so set status='void',voided_by=auth.uid(),voided_at=now(),notes=concat_ws(E'\n',notes,nullif(trim(coalesce(p_reason,'')),'')) where id=p_id and status='submitted';
 else raise exception 'COGS_INVALID_OPERATION_KIND';
 end if;
end; $$;

revoke all on function public.cogs_get_stock_position(uuid,date) from public,anon;
revoke all on function public.cogs_record_production(uuid,uuid,numeric,date,text) from public,anon;
revoke all on function public.cogs_record_menu_sale(uuid,uuid,numeric,date,numeric,text) from public,anon;
revoke all on function public.cogs_save_daily_so(uuid,date,jsonb,text) from public,anon;
revoke all on function public.cogs_cancel_operation(text,uuid,text) from public,anon;
grant execute on function public.cogs_get_stock_position(uuid,date) to authenticated;
grant execute on function public.cogs_record_production(uuid,uuid,numeric,date,text) to authenticated;
grant execute on function public.cogs_record_menu_sale(uuid,uuid,numeric,date,numeric,text) to authenticated;
grant execute on function public.cogs_save_daily_so(uuid,date,jsonb,text) to authenticated;
grant execute on function public.cogs_cancel_operation(text,uuid,text) to authenticated;

-- Replace old V1 recipe RPC signatures with division-scoped signatures for the frontend branch:
drop function if exists public.cogs_save_wip(uuid,text,numeric,text,boolean,jsonb);
create or replace function public.cogs_save_wip(p_id uuid,p_division_id uuid,p_name text,p_yield_qty numeric,p_yield_unit text,p_active boolean,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_parent uuid; v_line jsonb; v_type text; v_id uuid; v_qty numeric; v_unit text; v_base text; v_conv jsonb; v_factor numeric; v_child_unit text; v_child_div uuid; v_cycle boolean;
begin
 perform public.cogs_assert_division_module(p_division_id, 'cogs_wip');
 if not public.has_perm('cogs.wip.manage') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 if nullif(trim(p_name),'') is null or length(trim(p_name))>120 then raise exception 'INVALID_WIP_NAME'; end if;
 if p_yield_qty is null or p_yield_qty<=0 or nullif(trim(p_yield_unit),'') is null or length(trim(p_yield_unit))>32 then raise exception 'INVALID_WIP_YIELD'; end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' then raise exception 'INVALID_RECIPE_LINES'; end if;
 if p_id is null then insert into public.cogs_wip(division_id,name,yield_qty,yield_unit,active,created_by,updated_by) values(p_division_id,trim(p_name),p_yield_qty,trim(p_yield_unit),coalesce(p_active,true),auth.uid(),auth.uid()) returning id into v_parent;
 else update public.cogs_wip set name=trim(p_name),yield_qty=p_yield_qty,yield_unit=trim(p_yield_unit),active=coalesce(p_active,true),updated_by=auth.uid() where id=p_id and division_id=p_division_id returning id into v_parent; if v_parent is null then raise exception 'WIP_NOT_FOUND_OR_WRONG_DIVISION'; end if; end if;
 delete from public.cogs_wip_recipe_lines where wip_id=v_parent;
 for v_line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
  v_type:=lower(trim(coalesce(v_line->>'type',''))); v_id:=nullif(trim(coalesce(v_line->>'id','')),'')::uuid; v_qty:=nullif(trim(coalesce(v_line->>'qty','')),'')::numeric; v_unit:=nullif(trim(coalesce(v_line->>'unit','')),'');
  if v_type not in ('material','wip') or v_id is null or v_qty is null or v_qty<=0 or v_unit is null or length(v_unit)>32 then raise exception 'INVALID_RECIPE_LINE'; end if;
  if v_type='material' then
   select base_unit,conversions into v_base,v_conv from public.barapp_items where id=v_id and active=true and division_id=p_division_id; if not found then raise exception 'MATERIAL_NOT_FOUND_IN_DIVISION_OR_INACTIVE'; end if;
   if lower(v_unit)=lower(v_base) then v_factor:=1; else select nullif(c->>'factor','')::numeric into v_factor from jsonb_array_elements(coalesce(v_conv,'[]'::jsonb)) c where lower(coalesce(c->>'unit',''))=lower(v_unit) limit 1; end if;
   if v_factor is null or v_factor<=0 then raise exception 'INVALID_MATERIAL_UNIT'; end if;
   insert into public.cogs_wip_recipe_lines(wip_id,component_type,item_id,qty_input,unit_input,qty_base) values(v_parent,'material',v_id,v_qty,v_unit,v_qty*v_factor);
  else
   select yield_unit,division_id into v_child_unit,v_child_div from public.cogs_wip where id=v_id and active=true; if not found then raise exception 'WIP_COMPONENT_NOT_FOUND_OR_INACTIVE'; end if;
   if v_child_div<>p_division_id then raise exception 'COGS_COMPONENT_DIVISION_MISMATCH'; end if;
   if v_id=v_parent then raise exception 'COGS_WIP_CYCLE'; end if;
   if lower(v_unit)<>lower(v_child_unit) then raise exception 'INVALID_WIP_UNIT'; end if;
   insert into public.cogs_wip_recipe_lines(wip_id,component_type,component_wip_id,qty_input,unit_input,qty_base) values(v_parent,'wip',v_id,v_qty,v_unit,v_qty);
  end if;
 end loop;
 with recursive reach(id) as (
  select component_wip_id from public.cogs_wip_recipe_lines where wip_id=v_parent and component_type='wip' and component_wip_id is not null
  union select l.component_wip_id from public.cogs_wip_recipe_lines l join reach r on l.wip_id=r.id where l.component_type='wip' and l.component_wip_id is not null
 ) select exists(select 1 from reach where id=v_parent) into v_cycle;
 if coalesce(v_cycle,false) then raise exception 'COGS_WIP_CYCLE'; end if;
 return v_parent;
end; $$;

drop function if exists public.cogs_save_menu(uuid,text,numeric,boolean,jsonb);
create or replace function public.cogs_save_menu(p_id uuid,p_division_id uuid,p_name text,p_selling_price numeric,p_active boolean,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_parent uuid; v_line jsonb; v_type text; v_id uuid; v_qty numeric; v_unit text; v_base text; v_conv jsonb; v_factor numeric; v_child_unit text; v_child_div uuid;
begin
 perform public.cogs_assert_division_module(p_division_id, 'cogs_menu');
 if not public.has_perm('cogs.menu.manage') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 if nullif(trim(p_name),'') is null or length(trim(p_name))>120 then raise exception 'INVALID_MENU_NAME'; end if;
 if p_selling_price is null or p_selling_price<0 then raise exception 'INVALID_SELLING_PRICE'; end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' then raise exception 'INVALID_RECIPE_LINES'; end if;
 if p_id is null then insert into public.cogs_menus(division_id,name,selling_price,active,created_by,updated_by) values(p_division_id,trim(p_name),p_selling_price,coalesce(p_active,true),auth.uid(),auth.uid()) returning id into v_parent;
 else update public.cogs_menus set name=trim(p_name),selling_price=p_selling_price,active=coalesce(p_active,true),updated_by=auth.uid() where id=p_id and division_id=p_division_id returning id into v_parent; if v_parent is null then raise exception 'MENU_NOT_FOUND_OR_WRONG_DIVISION'; end if; end if;
 delete from public.cogs_menu_recipe_lines where menu_id=v_parent;
 for v_line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
  v_type:=lower(trim(coalesce(v_line->>'type',''))); v_id:=nullif(trim(coalesce(v_line->>'id','')),'')::uuid; v_qty:=nullif(trim(coalesce(v_line->>'qty','')),'')::numeric; v_unit:=nullif(trim(coalesce(v_line->>'unit','')),'');
  if v_type not in ('material','wip') or v_id is null or v_qty is null or v_qty<=0 or v_unit is null or length(v_unit)>32 then raise exception 'INVALID_RECIPE_LINE'; end if;
  if v_type='material' then
   select base_unit,conversions into v_base,v_conv from public.barapp_items where id=v_id and active=true and division_id=p_division_id; if not found then raise exception 'MATERIAL_NOT_FOUND_IN_DIVISION_OR_INACTIVE'; end if;
   if lower(v_unit)=lower(v_base) then v_factor:=1; else select nullif(c->>'factor','')::numeric into v_factor from jsonb_array_elements(coalesce(v_conv,'[]'::jsonb)) c where lower(coalesce(c->>'unit',''))=lower(v_unit) limit 1; end if;
   if v_factor is null or v_factor<=0 then raise exception 'INVALID_MATERIAL_UNIT'; end if;
   insert into public.cogs_menu_recipe_lines(menu_id,component_type,item_id,qty_input,unit_input,qty_base) values(v_parent,'material',v_id,v_qty,v_unit,v_qty*v_factor);
  else
   select yield_unit,division_id into v_child_unit,v_child_div from public.cogs_wip where id=v_id and active=true; if not found then raise exception 'WIP_COMPONENT_NOT_FOUND_OR_INACTIVE'; end if;
   if v_child_div<>p_division_id then raise exception 'COGS_COMPONENT_DIVISION_MISMATCH'; end if;
   if lower(v_unit)<>lower(v_child_unit) then raise exception 'INVALID_WIP_UNIT'; end if;
   insert into public.cogs_menu_recipe_lines(menu_id,component_type,component_wip_id,qty_input,unit_input,qty_base) values(v_parent,'wip',v_id,v_qty,v_unit,v_qty);
  end if;
 end loop;
 return v_parent;
end; $$;
revoke all on function public.cogs_save_wip(uuid,uuid,text,numeric,text,boolean,jsonb) from public,anon;
revoke all on function public.cogs_save_menu(uuid,uuid,text,numeric,boolean,jsonb) from public,anon;
grant execute on function public.cogs_save_wip(uuid,uuid,text,numeric,text,boolean,jsonb) to authenticated;
grant execute on function public.cogs_save_menu(uuid,uuid,text,numeric,boolean,jsonb) to authenticated;

create or replace function public.cogs_set_wip_active(p_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path=public
as $$ declare v_division uuid; begin
 select division_id into v_division from public.cogs_wip where id=p_id; if not found then raise exception 'WIP_NOT_FOUND'; end if;
 perform public.cogs_assert_division_module(v_division, 'cogs_wip');
 if not public.has_perm('cogs.wip.manage') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 update public.cogs_wip set active=coalesce(p_active,false),updated_by=auth.uid() where id=p_id;
end; $$;
create or replace function public.cogs_set_menu_active(p_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path=public
as $$ declare v_division uuid; begin
 select division_id into v_division from public.cogs_menus where id=p_id; if not found then raise exception 'MENU_NOT_FOUND'; end if;
 perform public.cogs_assert_division_module(v_division, 'cogs_menu');
 if not public.has_perm('cogs.menu.manage') then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 update public.cogs_menus set active=coalesce(p_active,false),updated_by=auth.uid() where id=p_id;
end; $$;
revoke all on function public.cogs_set_wip_active(uuid,boolean) from public,anon;
revoke all on function public.cogs_set_menu_active(uuid,boolean) from public,anon;
grant execute on function public.cogs_set_wip_active(uuid,boolean) to authenticated;
grant execute on function public.cogs_set_menu_active(uuid,boolean) to authenticated;

-- Narrow material lookup to COGS-enabled divisions the current account can access.
create or replace function public.cogs_list_materials()
returns table(id uuid,name text,base_unit text,conversions jsonb,reference_price_per_base numeric,reference_price_amount numeric,reference_price_unit text,last_purchase_price_per_base numeric,active boolean,division_id uuid)
language plpgsql security definer set search_path=public
as $$
begin
 if auth.uid() is null or coalesce(public.app_role(),'') not in ('dev','hr','div_admin','legacy_admin') then raise exception 'COGS_ADMIN_ONLY' using errcode='42501'; end if;
 if not (
  public.has_perm('inventory.view') or public.has_perm('inventory.manage')
  or public.has_perm('cogs.daily_so.system') or public.has_perm('cogs.daily_so.difference')
  or public.has_perm('cogs.daily_so.edit') or public.has_perm('cogs.production.view')
  or public.has_perm('cogs.production.manage') or public.has_perm('cogs.wip.view')
  or public.has_perm('cogs.wip.manage') or public.has_perm('cogs.menu.view')
  or public.has_perm('cogs.menu.manage') or public.has_perm('cogs.sales.view')
  or public.has_perm('cogs.sales.manage')
 ) then raise exception 'COGS_FEATURE_PERMISSION_DENIED' using errcode='42501'; end if;
 return query select i.id,i.name,i.base_unit,i.conversions,i.reference_price_per_base,i.reference_price_amount,i.reference_price_unit,i.last_purchase_price_per_base,i.active,i.division_id
 from public.barapp_items i join public.divisions d on d.id=i.division_id where d.has_cogs=true and coalesce(i.is_supply,false)=false and public.barapp_can_access_division(i.division_id) order by i.name;
end; $$;
revoke all on function public.cogs_list_materials() from public,anon;
grant execute on function public.cogs_list_materials() to authenticated;

revoke all on function public.cogs_wip_unit_cost(uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.cogs_wip_unit_cost_or_null(uuid) from public,anon,authenticated;
revoke all on function public.cogs_menu_unit_cost(uuid) from public,anon,authenticated;
revoke all on function public.cogs_expected_material_qty(uuid,date) from public,anon,authenticated;
revoke all on function public.cogs_expected_wip_qty(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.cogs_assert_ops_division(uuid) from public,anon,authenticated;
revoke all on function public.cogs_ops_can_access_division(uuid) from public,anon;
grant execute on function public.cogs_ops_can_access_division(uuid) to authenticated;

-- Trigger helpers should be callable only through triggers, not the public API.
revoke all on function public.cogs_touch_updated_at() from public,anon,authenticated;
