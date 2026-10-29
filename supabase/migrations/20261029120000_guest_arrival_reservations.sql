-- Guest Arrival reservations: separate records linked to operational arrivals only when seated.
create table if not exists public.guest_reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_code text not null unique,
  outlet_id uuid not null references public.outlets(id),
  guest_name text not null check (length(btrim(guest_name)) between 1 and 120),
  whatsapp text,
  packs integer not null check (packs between 1 and 500),
  reservation_at timestamptz not null,
  smoking_preference text not null default 'Non Smoking'
    check (smoking_preference in ('Non Smoking','Smoking')),
  note text check (note is null or length(note) <= 1000),
  status text not null default 'Menunggu Reservasi'
    check (status in ('Menunggu Reservasi','Duduk','Dibatalkan')),
  guest_arrival_id uuid unique references public.guest_arrivals(id),
  created_by uuid references auth.users(id),
  created_by_email text not null default 'unknown',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  cancellation_reason text,
  check ((status = 'Duduk') = (guest_arrival_id is not null))
);

create index if not exists guest_reservations_outlet_time_idx
  on public.guest_reservations (outlet_id, reservation_at);
create index if not exists guest_reservations_outlet_status_time_idx
  on public.guest_reservations (outlet_id, status, reservation_at);

alter table public.guest_reservations enable row level security;
revoke all on table public.guest_reservations from anon, authenticated;

create or replace function public.guest_reservation_list(
  p_month date,
  p_outlet_id uuid default null
) returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $function$
declare
  v_is_dev boolean;
  v_outlet_id uuid;
  v_result jsonb;
  v_start date;
begin
  perform public.guest_arrival_assert_access();
  if p_month is null then
    raise exception 'Bulan reservasi wajib dipilih.' using errcode='22023';
  end if;
  v_start := date_trunc('month', p_month)::date;
  v_is_dev := public.app_role()='dev';
  if v_is_dev then
    v_outlet_id := p_outlet_id;
    if v_outlet_id is null or not exists (
      select 1 from public.outlets o where o.id=v_outlet_id and o.active
    ) then
      raise exception 'Pilih satu outlet aktif terlebih dahulu.' using errcode='42501';
    end if;
  else
    v_outlet_id := public.guest_arrival_current_outlet();
    if v_outlet_id is null then
      raise exception 'Akun harus memiliki tepat satu outlet aktif.' using errcode='42501';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'reservation_code', r.reservation_code, 'outlet_id', r.outlet_id,
    'guest_name', r.guest_name, 'whatsapp', r.whatsapp, 'packs', r.packs,
    'reservation_at', r.reservation_at, 'smoking_preference', r.smoking_preference,
    'note', r.note, 'status', r.status, 'guest_arrival_id', r.guest_arrival_id,
    'created_at', r.created_at, 'created_by_email', r.created_by_email,
    'cancellation_reason', r.cancellation_reason
  ) order by r.reservation_at, r.created_at), '[]'::jsonb)
  into v_result
  from public.guest_reservations r
  where r.reservation_at >= v_start::timestamp at time zone 'Asia/Jakarta'
    and r.reservation_at < (v_start + interval '1 month')::timestamp at time zone 'Asia/Jakarta'
    and ((v_is_dev and (v_outlet_id is null or r.outlet_id=v_outlet_id))
      or (not v_is_dev and r.outlet_id=v_outlet_id));
  return v_result;
end;
$function$;

create or replace function public.guest_reservation_create(
  p_guest_name text,
  p_whatsapp text,
  p_packs integer,
  p_reservation_at timestamptz,
  p_smoking_preference text default 'Non Smoking',
  p_note text default null,
  p_outlet_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, auth
as $function$
declare
  v_is_dev boolean;
  v_outlet_id uuid;
  v_row public.guest_reservations;
begin
  perform public.guest_arrival_assert_access();
  v_is_dev := public.app_role()='dev';
  if v_is_dev then
    v_outlet_id := p_outlet_id;
    if v_outlet_id is null or not exists (
      select 1 from public.outlets o where o.id=v_outlet_id and o.active
    ) then
      raise exception 'Pilih satu outlet aktif terlebih dahulu.' using errcode='42501';
    end if;
  else
    v_outlet_id := public.guest_arrival_current_outlet();
    if v_outlet_id is null then
      raise exception 'Akun harus memiliki tepat satu outlet aktif.' using errcode='42501';
    end if;
  end if;

  if p_guest_name is null or length(btrim(p_guest_name)) not between 1 and 120 then
    raise exception 'Nama tamu wajib diisi (maksimal 120 karakter).' using errcode='22023';
  end if;
  if p_packs is null or p_packs not between 1 and 500 then
    raise exception 'Jumlah pack harus antara 1 sampai 500.' using errcode='22023';
  end if;
  if p_reservation_at is null or p_reservation_at < clock_timestamp() - interval '5 minutes' then
    raise exception 'Tanggal dan jam reservasi tidak boleh di masa lalu.' using errcode='22023';
  end if;
  if coalesce(p_smoking_preference,'') not in ('Non Smoking','Smoking') then
    raise exception 'Preferensi smoking tidak valid.' using errcode='22023';
  end if;
  if length(coalesce(p_note,'')) > 1000 then
    raise exception 'Catatan maksimal 1000 karakter.' using errcode='22023';
  end if;

  insert into public.guest_reservations (
    reservation_code, outlet_id, guest_name, whatsapp, packs, reservation_at,
    smoking_preference, note, created_by, created_by_email
  ) values (
    'RSV-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
    v_outlet_id, btrim(p_guest_name), nullif(btrim(coalesce(p_whatsapp,'')),''),
    p_packs, p_reservation_at, p_smoking_preference,
    nullif(btrim(coalesce(p_note,'')),''), auth.uid(),
    lower(coalesce(auth.jwt()->>'email','unknown'))
  ) returning * into v_row;

  return jsonb_build_object(
    'id',v_row.id,'reservation_code',v_row.reservation_code,'outlet_id',v_row.outlet_id,
    'guest_name',v_row.guest_name,'whatsapp',v_row.whatsapp,'packs',v_row.packs,
    'reservation_at',v_row.reservation_at,'smoking_preference',v_row.smoking_preference,
    'note',v_row.note,'status',v_row.status,'guest_arrival_id',v_row.guest_arrival_id,
    'created_at',v_row.created_at,'created_by_email',v_row.created_by_email,
    'cancellation_reason',v_row.cancellation_reason
  );
end;
$function$;

create or replace function public.guest_reservation_cancel(
  p_id uuid, p_reason text default null, p_outlet_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, auth
as $function$
declare
  v_is_dev boolean;
  v_outlet_id uuid;
  v_row public.guest_reservations;
begin
  perform public.guest_arrival_assert_access();
  v_is_dev := public.app_role()='dev';
  if v_is_dev then
    v_outlet_id := p_outlet_id;
    if v_outlet_id is null or not exists (
      select 1 from public.outlets o where o.id=v_outlet_id and o.active
    ) then
      raise exception 'Pilih satu outlet aktif terlebih dahulu.' using errcode='42501';
    end if;
  else
    v_outlet_id := public.guest_arrival_current_outlet();
    if v_outlet_id is null then
      raise exception 'Akun harus memiliki tepat satu outlet aktif.' using errcode='42501';
    end if;
  end if;

  select * into v_row from public.guest_reservations r
  where r.id=p_id
    and ((v_is_dev and (v_outlet_id is null or r.outlet_id=v_outlet_id))
      or (not v_is_dev and r.outlet_id=v_outlet_id))
  for update;
  if not found then raise exception 'Reservasi tidak ditemukan.' using errcode='P0002'; end if;
  if v_row.status <> 'Menunggu Reservasi' then
    raise exception 'Hanya reservasi yang masih menunggu yang dapat dibatalkan.' using errcode='55000';
  end if;
  if length(coalesce(p_reason,'')) > 300 then
    raise exception 'Alasan pembatalan maksimal 300 karakter.' using errcode='22023';
  end if;

  update public.guest_reservations
  set status='Dibatalkan', cancellation_reason=nullif(btrim(coalesce(p_reason,'')),''),
      updated_at=clock_timestamp()
  where id=v_row.id returning * into v_row;
  return jsonb_build_object(
    'id',v_row.id,'reservation_code',v_row.reservation_code,'outlet_id',v_row.outlet_id,
    'guest_name',v_row.guest_name,'whatsapp',v_row.whatsapp,'packs',v_row.packs,
    'reservation_at',v_row.reservation_at,'smoking_preference',v_row.smoking_preference,
    'note',v_row.note,'status',v_row.status,'guest_arrival_id',v_row.guest_arrival_id,
    'created_at',v_row.created_at,'created_by_email',v_row.created_by_email,
    'cancellation_reason',v_row.cancellation_reason
  );
end;
$function$;

create or replace function public.guest_reservation_seat(
  p_id uuid, p_table_name text, p_outlet_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, auth
as $function$
declare
  v_is_dev boolean;
  v_outlet_id uuid;
  v_row public.guest_reservations;
  v_arrival jsonb;
begin
  perform public.guest_arrival_assert_access();
  v_is_dev := public.app_role()='dev';
  if v_is_dev then
    v_outlet_id := p_outlet_id;
    if v_outlet_id is not null and not exists (
      select 1 from public.outlets o where o.id=v_outlet_id and o.active
    ) then
      raise exception 'Outlet yang dipilih tidak ditemukan atau tidak aktif.' using errcode='42501';
    end if;
  else
    v_outlet_id := public.guest_arrival_current_outlet();
    if v_outlet_id is null then
      raise exception 'Akun harus memiliki tepat satu outlet aktif.' using errcode='42501';
    end if;
  end if;
  if p_table_name is null or length(btrim(p_table_name)) not between 1 and 80 then
    raise exception 'Nomor atau nama meja wajib diisi (maksimal 80 karakter).' using errcode='22023';
  end if;

  select * into v_row from public.guest_reservations r
  where r.id=p_id
    and ((v_is_dev and (v_outlet_id is null or r.outlet_id=v_outlet_id))
      or (not v_is_dev and r.outlet_id=v_outlet_id))
  for update;
  if not found then raise exception 'Reservasi tidak ditemukan.' using errcode='P0002'; end if;
  if v_row.status='Duduk' and v_row.guest_arrival_id is not null then
    return jsonb_build_object('id',v_row.id,'reservation_code',v_row.reservation_code,
      'status',v_row.status,'guest_arrival_id',v_row.guest_arrival_id,'duplicate_request',true);
  end if;
  if v_row.status <> 'Menunggu Reservasi' then
    raise exception 'Hanya reservasi yang masih menunggu yang dapat diproses.' using errcode='55000';
  end if;

  v_arrival := public.guest_arrival_create(
    p_name=>v_row.guest_name, p_packs=>v_row.packs, p_whatsapp=>v_row.whatsapp,
    p_initial_status=>'Duduk', p_request_id=>v_row.id, p_outlet_id=>v_row.outlet_id,
    p_smoking_preference=>v_row.smoking_preference, p_note=>v_row.note,
    p_table_name=>btrim(p_table_name)
  );

  update public.guest_reservations
  set status='Duduk', guest_arrival_id=(v_arrival->>'id')::uuid,
      updated_at=clock_timestamp()
  where id=v_row.id;
  return jsonb_build_object('id',v_row.id,'reservation_code',v_row.reservation_code,
    'status','Duduk','guest_arrival_id',(v_arrival->>'id')::uuid,'arrival',v_arrival,
    'duplicate_request',coalesce((v_arrival->>'duplicate_request')::boolean,false));
end;
$function$;

revoke all on function public.guest_reservation_list(date,uuid) from public, anon;
revoke all on function public.guest_reservation_create(text,text,integer,timestamptz,text,text,uuid) from public, anon;
revoke all on function public.guest_reservation_cancel(uuid,text,uuid) from public, anon;
revoke all on function public.guest_reservation_seat(uuid,text,uuid) from public, anon;
grant execute on function public.guest_reservation_list(date,uuid) to authenticated;
grant execute on function public.guest_reservation_create(text,text,integer,timestamptz,text,text,uuid) to authenticated;
grant execute on function public.guest_reservation_cancel(uuid,text,uuid) to authenticated;
grant execute on function public.guest_reservation_seat(uuid,text,uuid) to authenticated;
