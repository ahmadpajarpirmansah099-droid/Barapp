-- Barapp COGS V1
-- Reuses public.barapp_items as the material master. All COGS writes go through admin-checked RPCs.
create table if not exists public.cogs_wip (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  yield_qty numeric not null default 1 check (yield_qty > 0),
  yield_unit text not null check (length(trim(yield_unit)) between 1 and 32),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cogs_wip_name_lower_uq on public.cogs_wip (lower(name));

create table if not exists public.cogs_wip_recipe_lines (
  id uuid primary key default gen_random_uuid(),
  wip_id uuid not null references public.cogs_wip(id) on delete cascade,
  component_type text not null check (component_type in ('material','wip')),
  item_id uuid references public.barapp_items(id) on delete restrict,
  component_wip_id uuid references public.cogs_wip(id) on delete restrict,
  qty_input numeric not null check (qty_input > 0),
  unit_input text not null check (length(trim(unit_input)) between 1 and 32),
  qty_base numeric not null check (qty_base > 0),
  created_at timestamptz not null default now(),
  constraint cogs_wip_line_component_ck check (
    (component_type='material' and item_id is not null and component_wip_id is null) or
    (component_type='wip' and item_id is null and component_wip_id is not null)
  )
);
create index if not exists cogs_wip_lines_parent_idx on public.cogs_wip_recipe_lines(wip_id);
create index if not exists cogs_wip_lines_child_idx on public.cogs_wip_recipe_lines(component_wip_id);

create table if not exists public.cogs_menus (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  selling_price numeric not null default 0 check (selling_price >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cogs_menus_name_lower_uq on public.cogs_menus (lower(name));

create table if not exists public.cogs_menu_recipe_lines (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.cogs_menus(id) on delete cascade,
  component_type text not null check (component_type in ('material','wip')),
  item_id uuid references public.barapp_items(id) on delete restrict,
  component_wip_id uuid references public.cogs_wip(id) on delete restrict,
  qty_input numeric not null check (qty_input > 0),
  unit_input text not null check (length(trim(unit_input)) between 1 and 32),
  qty_base numeric not null check (qty_base > 0),
  created_at timestamptz not null default now(),
  constraint cogs_menu_line_component_ck check (
    (component_type='material' and item_id is not null and component_wip_id is null) or
    (component_type='wip' and item_id is null and component_wip_id is not null)
  )
);
create index if not exists cogs_menu_lines_parent_idx on public.cogs_menu_recipe_lines(menu_id);
create index if not exists cogs_menu_lines_child_idx on public.cogs_menu_recipe_lines(component_wip_id);

create or replace function public.cogs_touch_updated_at()
returns trigger language plpgsql set search_path=public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists cogs_wip_touch_updated_at on public.cogs_wip;
create trigger cogs_wip_touch_updated_at before update on public.cogs_wip
for each row execute function public.cogs_touch_updated_at();
drop trigger if exists cogs_menus_touch_updated_at on public.cogs_menus;
create trigger cogs_menus_touch_updated_at before update on public.cogs_menus
for each row execute function public.cogs_touch_updated_at();

alter table public.cogs_wip enable row level security;
alter table public.cogs_wip_recipe_lines enable row level security;
alter table public.cogs_menus enable row level security;
alter table public.cogs_menu_recipe_lines enable row level security;

drop policy if exists cogs_wip_select_admin on public.cogs_wip;
create policy cogs_wip_select_admin on public.cogs_wip for select to authenticated
using ((select public.app_role()) in ('dev','hr','div_admin','legacy_admin'));
drop policy if exists cogs_wip_lines_select_admin on public.cogs_wip_recipe_lines;
create policy cogs_wip_lines_select_admin on public.cogs_wip_recipe_lines for select to authenticated
using ((select public.app_role()) in ('dev','hr','div_admin','legacy_admin'));
drop policy if exists cogs_menus_select_admin on public.cogs_menus;
create policy cogs_menus_select_admin on public.cogs_menus for select to authenticated
using ((select public.app_role()) in ('dev','hr','div_admin','legacy_admin'));
drop policy if exists cogs_menu_lines_select_admin on public.cogs_menu_recipe_lines;
create policy cogs_menu_lines_select_admin on public.cogs_menu_recipe_lines for select to authenticated
using ((select public.app_role()) in ('dev','hr','div_admin','legacy_admin'));

revoke all on public.cogs_wip, public.cogs_wip_recipe_lines, public.cogs_menus, public.cogs_menu_recipe_lines from public, anon, authenticated;
grant select on public.cogs_wip, public.cogs_wip_recipe_lines, public.cogs_menus, public.cogs_menu_recipe_lines to authenticated;

create or replace function public.cogs_save_wip(
  p_id uuid, p_name text, p_yield_qty numeric, p_yield_unit text, p_active boolean, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_parent uuid;
  v_line jsonb;
  v_type text;
  v_id uuid;
  v_qty numeric;
  v_unit text;
  v_base text;
  v_conv jsonb;
  v_factor numeric;
  v_child_unit text;
  v_cycle boolean;
begin
  if coalesce(public.app_role(),'') not in ('dev','hr','div_admin','legacy_admin') then
    raise exception 'COGS_ADMIN_ONLY' using errcode='42501';
  end if;
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if nullif(trim(p_name),'') is null or length(trim(p_name))>120 then raise exception 'INVALID_WIP_NAME'; end if;
  if p_yield_qty is null or p_yield_qty<=0 or nullif(trim(p_yield_unit),'') is null or length(trim(p_yield_unit))>32 then raise exception 'INVALID_WIP_YIELD'; end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' then raise exception 'INVALID_RECIPE_LINES'; end if;

  if p_id is null then
    insert into public.cogs_wip(name,yield_qty,yield_unit,active,created_by,updated_by)
    values(trim(p_name),p_yield_qty,trim(p_yield_unit),coalesce(p_active,true),auth.uid(),auth.uid())
    returning id into v_parent;
  else
    update public.cogs_wip set name=trim(p_name),yield_qty=p_yield_qty,yield_unit=trim(p_yield_unit),
      active=coalesce(p_active,true),updated_by=auth.uid()
    where id=p_id returning id into v_parent;
    if v_parent is null then raise exception 'WIP_NOT_FOUND'; end if;
  end if;

  delete from public.cogs_wip_recipe_lines where wip_id=v_parent;
  for v_line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb))
  loop
    v_type:=lower(trim(coalesce(v_line->>'type','')));
    v_id:=nullif(trim(coalesce(v_line->>'id','')),'')::uuid;
    v_qty:=nullif(trim(coalesce(v_line->>'qty','')),'')::numeric;
    v_unit:=nullif(trim(coalesce(v_line->>'unit','')),'');
    if v_type not in ('material','wip') or v_id is null or v_qty is null or v_qty<=0 or v_unit is null or length(v_unit)>32 then
      raise exception 'INVALID_RECIPE_LINE';
    end if;
    if v_type='material' then
      select base_unit,conversions into v_base,v_conv from public.barapp_items where id=v_id and active=true;
      if not found then raise exception 'MATERIAL_NOT_FOUND_OR_INACTIVE'; end if;
      if lower(v_unit)=lower(v_base) then v_factor:=1;
      else
        select nullif(c->>'factor','')::numeric into v_factor
        from jsonb_array_elements(coalesce(v_conv,'[]'::jsonb)) c
        where lower(coalesce(c->>'unit',''))=lower(v_unit) limit 1;
      end if;
      if v_factor is null or v_factor<=0 then raise exception 'INVALID_MATERIAL_UNIT'; end if;
      insert into public.cogs_wip_recipe_lines(wip_id,component_type,item_id,qty_input,unit_input,qty_base)
      values(v_parent,'material',v_id,v_qty,v_unit,v_qty*v_factor);
    else
      select yield_unit into v_child_unit from public.cogs_wip where id=v_id and active=true;
      if not found then raise exception 'WIP_COMPONENT_NOT_FOUND_OR_INACTIVE'; end if;
      if v_id=v_parent then raise exception 'COGS_WIP_CYCLE'; end if;
      if lower(v_unit)<>lower(v_child_unit) then raise exception 'INVALID_WIP_UNIT'; end if;
      insert into public.cogs_wip_recipe_lines(wip_id,component_type,component_wip_id,qty_input,unit_input,qty_base)
      values(v_parent,'wip',v_id,v_qty,v_unit,v_qty);
    end if;
  end loop;

  with recursive reach(id) as (
    select component_wip_id from public.cogs_wip_recipe_lines
      where wip_id=v_parent and component_type='wip' and component_wip_id is not null
    union
    select l.component_wip_id from public.cogs_wip_recipe_lines l
      join reach r on l.wip_id=r.id
      where l.component_type='wip' and l.component_wip_id is not null
  )
  select exists(select 1 from reach where id=v_parent) into v_cycle;
  if coalesce(v_cycle,false) then raise exception 'COGS_WIP_CYCLE'; end if;
  return v_parent;
end;
$$;

create or replace function public.cogs_save_menu(
  p_id uuid, p_name text, p_selling_price numeric, p_active boolean, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_parent uuid;
  v_line jsonb;
  v_type text;
  v_id uuid;
  v_qty numeric;
  v_unit text;
  v_base text;
  v_conv jsonb;
  v_factor numeric;
  v_child_unit text;
begin
  if coalesce(public.app_role(),'') not in ('dev','hr','div_admin','legacy_admin') then
    raise exception 'COGS_ADMIN_ONLY' using errcode='42501';
  end if;
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if nullif(trim(p_name),'') is null or length(trim(p_name))>120 then raise exception 'INVALID_MENU_NAME'; end if;
  if p_selling_price is null or p_selling_price<0 then raise exception 'INVALID_SELLING_PRICE'; end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' then raise exception 'INVALID_RECIPE_LINES'; end if;

  if p_id is null then
    insert into public.cogs_menus(name,selling_price,active,created_by,updated_by)
    values(trim(p_name),p_selling_price,coalesce(p_active,true),auth.uid(),auth.uid())
    returning id into v_parent;
  else
    update public.cogs_menus set name=trim(p_name),selling_price=p_selling_price,
      active=coalesce(p_active,true),updated_by=auth.uid()
    where id=p_id returning id into v_parent;
    if v_parent is null then raise exception 'MENU_NOT_FOUND'; end if;
  end if;

  delete from public.cogs_menu_recipe_lines where menu_id=v_parent;
  for v_line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb))
  loop
    v_type:=lower(trim(coalesce(v_line->>'type','')));
    v_id:=nullif(trim(coalesce(v_line->>'id','')),'')::uuid;
    v_qty:=nullif(trim(coalesce(v_line->>'qty','')),'')::numeric;
    v_unit:=nullif(trim(coalesce(v_line->>'unit','')),'');
    if v_type not in ('material','wip') or v_id is null or v_qty is null or v_qty<=0 or v_unit is null or length(v_unit)>32 then
      raise exception 'INVALID_RECIPE_LINE';
    end if;
    if v_type='material' then
      select base_unit,conversions into v_base,v_conv from public.barapp_items where id=v_id and active=true;
      if not found then raise exception 'MATERIAL_NOT_FOUND_OR_INACTIVE'; end if;
      if lower(v_unit)=lower(v_base) then v_factor:=1;
      else
        select nullif(c->>'factor','')::numeric into v_factor
        from jsonb_array_elements(coalesce(v_conv,'[]'::jsonb)) c
        where lower(coalesce(c->>'unit',''))=lower(v_unit) limit 1;
      end if;
      if v_factor is null or v_factor<=0 then raise exception 'INVALID_MATERIAL_UNIT'; end if;
      insert into public.cogs_menu_recipe_lines(menu_id,component_type,item_id,qty_input,unit_input,qty_base)
      values(v_parent,'material',v_id,v_qty,v_unit,v_qty*v_factor);
    else
      select yield_unit into v_child_unit from public.cogs_wip where id=v_id and active=true;
      if not found then raise exception 'WIP_COMPONENT_NOT_FOUND_OR_INACTIVE'; end if;
      if lower(v_unit)<>lower(v_child_unit) then raise exception 'INVALID_WIP_UNIT'; end if;
      insert into public.cogs_menu_recipe_lines(menu_id,component_type,component_wip_id,qty_input,unit_input,qty_base)
      values(v_parent,'wip',v_id,v_qty,v_unit,v_qty);
    end if;
  end loop;
  return v_parent;
end;
$$;

create or replace function public.cogs_set_wip_active(p_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if coalesce(public.app_role(),'') not in ('dev','hr','div_admin','legacy_admin') or auth.uid() is null then
    raise exception 'COGS_ADMIN_ONLY' using errcode='42501';
  end if;
  update public.cogs_wip set active=coalesce(p_active,false),updated_by=auth.uid() where id=p_id;
  if not found then raise exception 'WIP_NOT_FOUND'; end if;
end;
$$;

create or replace function public.cogs_set_menu_active(p_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if coalesce(public.app_role(),'') not in ('dev','hr','div_admin','legacy_admin') or auth.uid() is null then
    raise exception 'COGS_ADMIN_ONLY' using errcode='42501';
  end if;
  update public.cogs_menus set active=coalesce(p_active,false),updated_by=auth.uid() where id=p_id;
  if not found then raise exception 'MENU_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.cogs_save_wip(uuid,text,numeric,text,boolean,jsonb) from public, anon;
revoke all on function public.cogs_save_menu(uuid,text,numeric,boolean,jsonb) from public, anon;
revoke all on function public.cogs_set_wip_active(uuid,boolean) from public, anon;
revoke all on function public.cogs_set_menu_active(uuid,boolean) from public, anon;
grant execute on function public.cogs_save_wip(uuid,text,numeric,text,boolean,jsonb) to authenticated;
grant execute on function public.cogs_save_menu(uuid,text,numeric,boolean,jsonb) to authenticated;
grant execute on function public.cogs_set_wip_active(uuid,boolean) to authenticated;
grant execute on function public.cogs_set_menu_active(uuid,boolean) to authenticated;
