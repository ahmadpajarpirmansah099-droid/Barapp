-- BARAPP Inventory migration v1
-- Uses existing public.divisions, public.user_scopes and public.app_role().
-- Does not alter attendance, employees, or payroll data.
create table if not exists public.barapp_items (
 id uuid primary key default gen_random_uuid(),
 division_id uuid not null references public.divisions(id),
 name text not null check (length(trim(name)) between 1 and 120),
 base_unit text not null check (length(trim(base_unit)) between 1 and 20),
 conversions jsonb not null check (jsonb_typeof(conversions)='array' and jsonb_array_length(conversions)>0),
 reference_price_per_base numeric(18,6) not null default 0 check(reference_price_per_base>=0),
 reference_price_amount numeric(18,2) not null default 0 check(reference_price_amount>=0),
 reference_price_unit text not null,
 last_purchase_price_per_base numeric(18,6),
 active boolean not null default true,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(division_id,name)
);
create table if not exists public.barapp_stock_in (
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.barapp_items(id),
 division_id uuid not null references public.divisions(id),
 received_at date not null default (now() at time zone 'Asia/Jakarta')::date,
 qty_input numeric(18,6) not null check(qty_input>0),
 unit_input text not null,
 qty_base numeric(18,6) not null check(qty_base>0),
 invoice_total numeric(18,2) check(invoice_total is null or invoice_total>=0),
 estimated_total numeric(18,2) not null default 0 check(estimated_total>=0),
 price_source text not null check(price_source in ('invoice','master')),
 status text not null default 'posted' check(status in ('posted','cancelled')),
 notes text,
 created_by uuid references auth.users(id) on delete set null,
 cancelled_by uuid references auth.users(id) on delete set null,
 cancelled_at timestamptz,
 created_at timestamptz not null default now(),
 check((price_source='invoice' and invoice_total is not null) or (price_source='master' and invoice_total is null))
);
create table if not exists public.barapp_stock_returns (
 id uuid primary key default gen_random_uuid(),
 stock_in_id uuid not null references public.barapp_stock_in(id),
 item_id uuid not null references public.barapp_items(id),
 division_id uuid not null references public.divisions(id),
 returned_at date not null default (now() at time zone 'Asia/Jakarta')::date,
 qty_base numeric(18,6) not null check(qty_base>0),
 status text not null default 'posted' check(status in ('posted','cancelled')),
 reason text,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists barapp_items_div_active_idx on public.barapp_items(division_id,active,name);
create unique index if not exists barapp_items_name_ci on public.barapp_items(division_id,lower(name));
create index if not exists barapp_stock_in_item_date_idx on public.barapp_stock_in(item_id,received_at desc);
create index if not exists barapp_returns_receipt_idx on public.barapp_stock_returns(stock_in_id,status);

create or replace function public.barapp_can_access_division(p_division_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select auth.uid() is not null and (
  coalesce(public.app_role(),'') in ('dev','hr','legacy_admin')
  or (coalesce(public.app_role(),'')='div_admin' and exists(
   select 1 from public.user_scopes us where us.user_id=auth.uid() and us.division_id=p_division_id
  ))
 );
$$;
create or replace function public.barapp_can_manage_division(p_division_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select auth.uid() is not null and coalesce(public.app_role(),'') in ('dev','hr','legacy_admin','div_admin')
 and public.barapp_can_access_division(p_division_id);
$$;

create or replace function public.barapp_inventory_guard()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare it public.barapp_items%rowtype; rec public.barapp_stock_in%rowtype; total_ret numeric;
begin
 if tg_table_name='barapp_items' then
  if tg_op='UPDATE' and (new.name is distinct from old.name or new.division_id is distinct from old.division_id or new.base_unit is distinct from old.base_unit or new.conversions is distinct from old.conversions or new.reference_price_per_base is distinct from old.reference_price_per_base or new.reference_price_amount is distinct from old.reference_price_amount or new.reference_price_unit is distinct from old.reference_price_unit or new.created_by is distinct from old.created_by) then raise exception 'MASTER_FIELDS_LOCKED'; end if;
  if tg_op='UPDATE' and new.last_purchase_price_per_base is distinct from old.last_purchase_price_per_base and current_setting('barapp.price_update',true) is distinct from '1' then raise exception 'LAST_PRICE_AUTOMATIC'; end if;
  if not public.barapp_can_manage_division(new.division_id) then raise exception 'INVENTORY_ACCESS_DENIED'; end if;
  if not exists(select 1 from jsonb_array_elements(new.conversions) c where lower(trim(c->>'unit'))=lower(trim(new.base_unit)) and (c->>'factor')::numeric=1) then raise exception 'BASE_UNIT_FACTOR_MUST_BE_1'; end if;
  if exists(select 1 from jsonb_array_elements(new.conversions) c where nullif(trim(c->>'unit'),'') is null or coalesce((c->>'factor')::numeric,0)<=0) then raise exception 'INVALID_CONVERSION'; end if;
  if exists(select lower(trim(c->>'unit')) from jsonb_array_elements(new.conversions) c group by 1 having count(*)>1) then raise exception 'DUPLICATE_UNIT'; end if;
  if tg_op='INSERT' then new.created_by:=auth.uid(); end if; new.updated_at:=now(); return new;
 elsif tg_table_name='barapp_stock_in' then
  select * into it from public.barapp_items where id=new.item_id;
  if not found or it.division_id<>new.division_id then raise exception 'ITEM_DIVISION_MISMATCH'; end if;
  if not public.barapp_can_manage_division(new.division_id) then raise exception 'INVENTORY_ACCESS_DENIED'; end if;
  if tg_op='UPDATE' and (new.item_id is distinct from old.item_id or new.division_id is distinct from old.division_id or new.received_at is distinct from old.received_at or new.qty_input is distinct from old.qty_input or new.unit_input is distinct from old.unit_input or new.qty_base is distinct from old.qty_base or new.invoice_total is distinct from old.invoice_total or new.estimated_total is distinct from old.estimated_total or new.price_source is distinct from old.price_source or new.notes is distinct from old.notes) then raise exception 'RECEIPT_FIELDS_LOCKED'; end if;
  if new.status='posted' and not exists(select 1 from jsonb_array_elements(it.conversions) c where lower(trim(c->>'unit'))=lower(trim(new.unit_input)) and abs((c->>'factor')::numeric*new.qty_input-new.qty_base)<0.000001) then raise exception 'CONVERSION_MISMATCH'; end if;
  if tg_op='UPDATE' and old.status='posted' and new.status='cancelled' and exists(select 1 from public.barapp_stock_returns r where r.stock_in_id=old.id and r.status='posted') then raise exception 'RECEIPT_HAS_RETURNS'; end if;
  if tg_op='INSERT' then new.created_by:=auth.uid(); end if;
  if tg_op='UPDATE' and old.status='posted' and new.status='cancelled' then new.cancelled_by:=auth.uid(); new.cancelled_at:=now(); end if; return new;
 elsif tg_table_name='barapp_stock_returns' then
  select * into rec from public.barapp_stock_in where id=new.stock_in_id;
  if not found or rec.item_id<>new.item_id or rec.division_id<>new.division_id or rec.status<>'posted' then raise exception 'INVALID_RETURN_SOURCE'; end if;
  if not public.barapp_can_manage_division(new.division_id) then raise exception 'INVENTORY_ACCESS_DENIED'; end if;
  select coalesce(sum(qty_base),0) into total_ret from public.barapp_stock_returns where stock_in_id=new.stock_in_id and status='posted' and id<>new.id;
  if new.status='posted' and total_ret+new.qty_base>rec.qty_base+0.000001 then raise exception 'RETURN_EXCEEDS_RECEIPT'; end if;
  if tg_op='INSERT' then new.created_by:=auth.uid(); end if; return new;
 end if;
 return new;
end $$;
drop trigger if exists barapp_items_guard on public.barapp_items;
create trigger barapp_items_guard before insert or update on public.barapp_items for each row execute function public.barapp_inventory_guard();
drop trigger if exists barapp_stock_in_guard on public.barapp_stock_in;
create trigger barapp_stock_in_guard before insert or update on public.barapp_stock_in for each row execute function public.barapp_inventory_guard();
drop trigger if exists barapp_returns_guard on public.barapp_stock_returns;
create trigger barapp_returns_guard before insert on public.barapp_stock_returns for each row execute function public.barapp_inventory_guard();

create or replace function public.barapp_recalc_last_price(p_item uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare p numeric;
begin
 select invoice_total/nullif(qty_base,0) into p from public.barapp_stock_in s
 where s.item_id=p_item and s.status='posted' and s.invoice_total is not null
 and s.qty_base>coalesce((select sum(r.qty_base) from public.barapp_stock_returns r where r.stock_in_id=s.id and r.status='posted'),0)+0.000001
 order by s.received_at desc,s.created_at desc limit 1;
 perform set_config('barapp.price_update','1',true);
 update public.barapp_items set last_purchase_price_per_base=p,updated_at=now() where id=p_item;
 perform set_config('barapp.price_update','0',true);
end $$;
create or replace function public.barapp_refresh_last_price()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
 perform public.barapp_recalc_last_price(coalesce(new.item_id,old.item_id)); return new;
end $$;
drop trigger if exists barapp_stock_in_price on public.barapp_stock_in;
create trigger barapp_stock_in_price after insert or update of status,invoice_total,qty_base,received_at on public.barapp_stock_in for each row execute function public.barapp_refresh_last_price();
drop trigger if exists barapp_return_price on public.barapp_stock_returns;
create trigger barapp_return_price after insert or update of status,qty_base on public.barapp_stock_returns for each row execute function public.barapp_refresh_last_price();

alter table public.barapp_items enable row level security;
alter table public.barapp_stock_in enable row level security;
alter table public.barapp_stock_returns enable row level security;
drop policy if exists barapp_items_read on public.barapp_items;
create policy barapp_items_read on public.barapp_items for select to authenticated using(public.barapp_can_access_division(division_id));
drop policy if exists barapp_items_insert on public.barapp_items;
create policy barapp_items_insert on public.barapp_items for insert to authenticated with check(public.barapp_can_manage_division(division_id));
drop policy if exists barapp_items_update on public.barapp_items;
create policy barapp_items_update on public.barapp_items for update to authenticated using(public.barapp_can_manage_division(division_id)) with check(public.barapp_can_manage_division(division_id));
drop policy if exists barapp_stock_read on public.barapp_stock_in;
create policy barapp_stock_read on public.barapp_stock_in for select to authenticated using(public.barapp_can_access_division(division_id));
drop policy if exists barapp_stock_insert on public.barapp_stock_in;
create policy barapp_stock_insert on public.barapp_stock_in for insert to authenticated with check(public.barapp_can_manage_division(division_id));
drop policy if exists barapp_stock_update on public.barapp_stock_in;
create policy barapp_stock_update on public.barapp_stock_in for update to authenticated using(public.barapp_can_manage_division(division_id)) with check(public.barapp_can_manage_division(division_id));
drop policy if exists barapp_returns_read on public.barapp_stock_returns;
create policy barapp_returns_read on public.barapp_stock_returns for select to authenticated using(public.barapp_can_access_division(division_id));
drop policy if exists barapp_returns_insert on public.barapp_stock_returns;
create policy barapp_returns_insert on public.barapp_stock_returns for insert to authenticated with check(public.barapp_can_manage_division(division_id));
grant select,insert,update on public.barapp_items,public.barapp_stock_in to authenticated;
grant select,insert on public.barapp_stock_returns to authenticated;
revoke update,delete on public.barapp_stock_returns from authenticated;
create or replace view public.barapp_stock_balance with(security_invoker=true) as
 select i.id item_id,i.division_id,i.name,i.base_unit,
 coalesce((select sum(s.qty_base) from public.barapp_stock_in s where s.item_id=i.id and s.status='posted'),0)
 - coalesce((select sum(r.qty_base) from public.barapp_stock_returns r where r.item_id=i.id and r.status='posted'),0) qty_base
 from public.barapp_items i;
grant select on public.barapp_stock_balance to authenticated;
revoke all on function public.barapp_inventory_guard() from public,anon,authenticated;
revoke all on function public.barapp_refresh_last_price() from public,anon,authenticated;
revoke all on function public.barapp_recalc_last_price(uuid) from public,anon,authenticated;
revoke all on function public.barapp_can_access_division(uuid) from public,anon;
revoke all on function public.barapp_can_manage_division(uuid) from public,anon;
grant execute on function public.barapp_can_access_division(uuid),public.barapp_can_manage_division(uuid) to authenticated;
-- Verify: select count(*) from public.barapp_items;
