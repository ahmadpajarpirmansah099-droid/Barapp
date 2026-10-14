-- COGS material read adapter: admins can use the shared inventory master without broadening inventory table policies.
create or replace function public.cogs_list_materials()
returns table (
  id uuid,
  name text,
  base_unit text,
  conversions jsonb,
  reference_price_per_base numeric,
  reference_price_amount numeric,
  reference_price_unit text,
  last_purchase_price_per_base numeric,
  active boolean,
  division_id uuid
)
language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null or coalesce(public.app_role(),'') not in ('dev','hr','div_admin','legacy_admin') then
    raise exception 'COGS_ADMIN_ONLY' using errcode='42501';
  end if;
  return query
    select i.id,i.name,i.base_unit,i.conversions,i.reference_price_per_base,
      i.reference_price_amount,i.reference_price_unit,i.last_purchase_price_per_base,
      i.active,i.division_id
    from public.barapp_items i
    order by i.name;
end;
$$;
revoke all on function public.cogs_list_materials() from public, anon;
grant execute on function public.cogs_list_materials() to authenticated;
