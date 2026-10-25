BEGIN;

SELECT set_config(
  'app.change_reason',
  'Separate Guest Arrival by outlet and restrict service accounts to assigned outlet',
  true
);

DO $$
BEGIN
  IF (SELECT count(*) FROM auth.users WHERE lower(email) IN ('admin@div.service','admin@mnk.service')) <> 2 THEN
    RAISE EXCEPTION 'Both service Auth accounts must exist before enabling outlet-scoped Guest Arrival.';
  END IF;
  IF (SELECT count(*) FROM public.outlets WHERE code IN ('LJN','MNK') AND active) <> 2 THEN
    RAISE EXCEPTION 'Active outlets LJN and MNK are required for Guest Arrival outlet separation.';
  END IF;
  IF (SELECT count(*) FROM public.divisions d JOIN public.outlets o ON o.id=d.outlet_id WHERE o.code='LJN' AND lower(d.name)='service' AND d.active) <> 1 THEN
    RAISE EXCEPTION 'Exactly one active Service division must exist for outlet LJN.';
  END IF;
  IF (SELECT count(*) FROM public.divisions d JOIN public.outlets o ON o.id=d.outlet_id WHERE o.code='MNK' AND lower(d.name)='service' AND d.active) <> 1 THEN
    RAISE EXCEPTION 'Exactly one active Service division must exist for outlet MNK.';
  END IF;
END
$$;

-- Existing Guest Arrival records belong to the original service account at outlet LJN.
ALTER TABLE public.guest_arrivals ADD COLUMN IF NOT EXISTS outlet_id uuid;
UPDATE public.guest_arrivals
SET outlet_id = (SELECT id FROM public.outlets WHERE code='LJN' AND active LIMIT 1)
WHERE outlet_id IS NULL;
ALTER TABLE public.guest_arrivals ALTER COLUMN outlet_id SET NOT NULL;
ALTER TABLE public.guest_arrivals
  DROP CONSTRAINT IF EXISTS guest_arrivals_operational_queue_unique;
ALTER TABLE public.guest_arrivals
  ADD CONSTRAINT guest_arrivals_outlet_operational_queue_unique
  UNIQUE (outlet_id, operational_date, queue_number);
ALTER TABLE public.guest_arrivals
  ADD CONSTRAINT guest_arrivals_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES public.outlets(id) ON DELETE RESTRICT;

-- Queue counters must be independent per outlet and operational date.
ALTER TABLE public.guest_arrival_daily_counters ADD COLUMN IF NOT EXISTS outlet_id uuid;
UPDATE public.guest_arrival_daily_counters
SET outlet_id = (SELECT id FROM public.outlets WHERE code='LJN' AND active LIMIT 1)
WHERE outlet_id IS NULL;
ALTER TABLE public.guest_arrival_daily_counters ALTER COLUMN outlet_id SET NOT NULL;
ALTER TABLE public.guest_arrival_daily_counters
  DROP CONSTRAINT IF EXISTS guest_arrival_daily_counters_pkey;
ALTER TABLE public.guest_arrival_daily_counters
  ADD CONSTRAINT guest_arrival_daily_counters_pkey PRIMARY KEY (outlet_id, operational_date);
ALTER TABLE public.guest_arrival_daily_counters
  ADD CONSTRAINT guest_arrival_daily_counters_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES public.outlets(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS guest_arrivals_outlet_date_status_queue_idx
  ON public.guest_arrivals (outlet_id, operational_date, status, queue_number);
CREATE INDEX IF NOT EXISTS guest_arrival_changes_arrival_time_idx
  ON public.guest_arrival_changes (guest_arrival_id, changed_at DESC);

-- Provision both service accounts with exactly one outlet/service scope and no old HR permissions.
UPDATE public.user_profiles p
SET role='guest_arrival', active=true, email=u.email
FROM auth.users u
WHERE p.user_id=u.id
  AND lower(u.email) IN ('admin@div.service','admin@mnk.service');

DELETE FROM public.user_permissions up
USING auth.users u
WHERE up.user_id=u.id
  AND lower(u.email) IN ('admin@div.service','admin@mnk.service');

DELETE FROM public.user_scopes s
USING auth.users u
WHERE s.user_id=u.id
  AND lower(u.email) IN ('admin@div.service','admin@mnk.service');

INSERT INTO public.user_scopes (user_id, outlet_id, division_id)
SELECT u.id, o.id, d.id
FROM auth.users u
JOIN public.outlets o
  ON (lower(u.email)='admin@div.service' AND o.code='LJN')
  OR (lower(u.email)='admin@mnk.service' AND o.code='MNK')
JOIN public.divisions d
  ON d.outlet_id=o.id AND lower(d.name)='service' AND d.active
WHERE lower(u.email) IN ('admin@div.service','admin@mnk.service');

-- Authorization checks for Guest Arrival service identities and outlet scopes.
CREATE OR REPLACE FUNCTION public.guest_arrival_can_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
  SELECT COALESCE(
    public.app_role() = 'dev'
    OR (
      public.app_role() = 'guest_arrival'
      AND EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.user_id = auth.uid()
          AND up.active
          AND up.role = 'guest_arrival'
          AND lower(up.email) = lower(COALESCE(auth.jwt() ->> 'email',''))
          AND lower(up.email) IN ('admin@div.service','admin@mnk.service')
          AND (
            SELECT count(DISTINCT s.outlet_id)
            FROM public.user_scopes s
            JOIN public.outlets o ON o.id=s.outlet_id AND o.active
            WHERE s.user_id=up.user_id
          ) = 1
      )
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_current_outlet()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
DECLARE
  v_outlet uuid;
BEGIN
  IF public.app_role() = 'dev' OR NOT public.guest_arrival_can_access() THEN
    RETURN NULL;
  END IF;

  SELECT min(s.outlet_id::text)::uuid
  INTO v_outlet
  FROM public.user_scopes s
  JOIN public.outlets o ON o.id=s.outlet_id AND o.active
  WHERE s.user_id=auth.uid();

  RETURN v_outlet;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_assert_access()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
BEGIN
  IF NOT public.guest_arrival_can_access() THEN
    RAISE EXCEPTION 'Akses Guest Arrival ditolak.'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_row_json(p_row public.guest_arrivals)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'outlet_id', p_row.outlet_id,
    'outlet_code', (SELECT o.code FROM public.outlets o WHERE o.id=p_row.outlet_id),
    'outlet_name', (SELECT o.name FROM public.outlets o WHERE o.id=p_row.outlet_id),
    'operational_date', p_row.operational_date,
    'queue_number', p_row.queue_number,
    'queue_code', 'WL-' || lpad(p_row.queue_number::text, 3, '0'),
    'guest_name', p_row.guest_name,
    'packs', p_row.packs,
    'whatsapp', p_row.whatsapp,
    'arrived_at', p_row.arrived_at,
    'status', p_row.status,
    'finished_at', p_row.finished_at,
    'waiting_seconds', p_row.waiting_seconds,
    'cancellation_reason', p_row.cancellation_reason,
    'created_by_email', p_row.created_by_email,
    'created_at', p_row.created_at,
    'correction_count', (
      SELECT count(*) FROM public.guest_arrival_changes c
      WHERE c.guest_arrival_id = p_row.id AND c.change_type = 'CORRECTION'
    ),
    'last_correction_at', (
      SELECT max(c.changed_at) FROM public.guest_arrival_changes c
      WHERE c.guest_arrival_id = p_row.id AND c.change_type = 'CORRECTION'
    ),
    'last_correction_reason', (
      SELECT c.reason FROM public.guest_arrival_changes c
      WHERE c.guest_arrival_id = p_row.id AND c.change_type = 'CORRECTION'
      ORDER BY c.changed_at DESC LIMIT 1
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
DECLARE
  v_outlet_id uuid;
  v_result jsonb;
BEGIN
  PERFORM public.guest_arrival_assert_access();
  IF public.app_role()='dev' THEN
    RETURN jsonb_build_object(
      'is_developer', true,
      'outlet_id', NULL,
      'outlet_code', 'ALL',
      'outlet_name', 'Semua Outlet'
    );
  END IF;

  v_outlet_id := public.guest_arrival_current_outlet();
  SELECT jsonb_build_object(
    'is_developer', false,
    'outlet_id', o.id,
    'outlet_code', o.code,
    'outlet_name', o.name
  )
  INTO v_result
  FROM public.outlets o
  WHERE o.id=v_outlet_id AND o.active;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Outlet Guest Arrival tidak ditemukan atau tidak aktif.'
      USING ERRCODE = '42501';
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_create(
  p_name text,
  p_packs integer,
  p_whatsapp text,
  p_initial_status text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
DECLARE
  v_date date;
  v_now timestamptz;
  v_number integer;
  v_row public.guest_arrivals;
  v_outlet_id uuid;
  v_is_dev boolean;
BEGIN
  PERFORM public.guest_arrival_assert_access();
  v_is_dev := public.app_role()='dev';
  IF v_is_dev THEN
    SELECT id INTO v_outlet_id FROM public.outlets WHERE code='LJN' AND active LIMIT 1;
  ELSE
    v_outlet_id := public.guest_arrival_current_outlet();
  END IF;
  IF v_outlet_id IS NULL THEN
    RAISE EXCEPTION 'Outlet Guest Arrival tidak ditemukan.'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Permintaan pendaftaran tidak memiliki ID idempotensi.'
      USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Nama tamu wajib diisi.'
      USING ERRCODE = '22023';
  END IF;
  IF p_packs IS NULL OR p_packs < 1 THEN
    RAISE EXCEPTION 'Jumlah pack minimal 1.'
      USING ERRCODE = '22023';
  END IF;
  IF p_initial_status NOT IN ('Menunggu', 'Selesai') THEN
    RAISE EXCEPTION 'Status awal tidak valid.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  SELECT * INTO v_row FROM public.guest_arrivals WHERE request_id=p_request_id;
  IF FOUND THEN
    IF NOT v_is_dev AND v_row.outlet_id<>v_outlet_id THEN
      RAISE EXCEPTION 'Permintaan pendaftaran ini sudah dipakai di outlet lain.'
        USING ERRCODE = '42501';
    END IF;
    RETURN public.guest_arrival_row_json(v_row) || jsonb_build_object('duplicate_request', true);
  END IF;

  v_now := clock_timestamp();
  v_date := (v_now AT TIME ZONE 'Asia/Jakarta')::date;

  INSERT INTO public.guest_arrival_daily_counters (outlet_id, operational_date, last_number)
  VALUES (v_outlet_id, v_date, 0)
  ON CONFLICT (outlet_id, operational_date) DO NOTHING;

  UPDATE public.guest_arrival_daily_counters
  SET last_number=last_number+1, updated_at=v_now
  WHERE outlet_id=v_outlet_id AND operational_date=v_date
  RETURNING last_number INTO v_number;

  INSERT INTO public.guest_arrivals (
    outlet_id, operational_date, queue_number, guest_name, packs, whatsapp, arrived_at,
    status, finished_at, waiting_seconds, cancellation_reason, request_id,
    created_by, created_by_email
  )
  VALUES (
    v_outlet_id, v_date, v_number, btrim(p_name), p_packs,
    NULLIF(btrim(COALESCE(p_whatsapp,'')), ''), v_now, p_initial_status,
    CASE WHEN p_initial_status='Selesai' THEN v_now ELSE NULL END,
    CASE WHEN p_initial_status='Selesai' THEN 0 ELSE NULL END,
    NULL, p_request_id, auth.uid(), lower(COALESCE(auth.jwt()->>'email','unknown'))
  )
  RETURNING * INTO v_row;

  RETURN public.guest_arrival_row_json(v_row) || jsonb_build_object('duplicate_request', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_list(
  p_scope text,
  p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_date date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  v_server_now timestamptz := clock_timestamp();
  v_result jsonb;
  v_is_dev boolean;
  v_outlet_id uuid;
BEGIN
  PERFORM public.guest_arrival_assert_access();
  v_is_dev := public.app_role()='dev';
  IF NOT v_is_dev THEN v_outlet_id := public.guest_arrival_current_outlet(); END IF;

  IF p_scope NOT IN ('today','pending','history') THEN
    RAISE EXCEPTION 'Mode daftar tamu tidak valid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    jsonb_agg(public.guest_arrival_row_json(g) || jsonb_build_object('server_now',v_server_now)
      ORDER BY g.operational_date,g.queue_number),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.guest_arrivals g
  WHERE (
    (p_scope='today' AND g.operational_date=v_today AND g.status='Menunggu')
    OR (p_scope='pending' AND g.operational_date<v_today AND g.status='Menunggu')
    OR (p_scope='history' AND g.operational_date=v_date)
  )
  AND (v_is_dev OR g.outlet_id=v_outlet_id);

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_detail(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
DECLARE
  v_row public.guest_arrivals;
  v_result jsonb;
  v_is_dev boolean;
  v_outlet_id uuid;
BEGIN
  PERFORM public.guest_arrival_assert_access();
  v_is_dev := public.app_role()='dev';
  IF NOT v_is_dev THEN v_outlet_id := public.guest_arrival_current_outlet(); END IF;

  SELECT * INTO v_row
  FROM public.guest_arrivals
  WHERE id=p_id AND (v_is_dev OR outlet_id=v_outlet_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data tamu tidak ditemukan.'
      USING ERRCODE = 'P0002';
  END IF;

  v_result := public.guest_arrival_row_json(v_row) || jsonb_build_object(
    'changes',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',c.id,'change_type',c.change_type,'actor_email',c.actor_email,
        'changed_at',c.changed_at,'reason',c.reason,'old_data',c.old_data,'new_data',c.new_data
      ) ORDER BY c.changed_at DESC)
      FROM public.guest_arrival_changes c WHERE c.guest_arrival_id=v_row.id
    ),'[]'::jsonb)
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_set_status(
  p_id uuid,p_status text,p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
DECLARE
  v_row public.guest_arrivals;
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz;
  v_is_dev boolean;
  v_outlet_id uuid;
BEGIN
  PERFORM public.guest_arrival_assert_access();
  v_is_dev := public.app_role()='dev';
  IF NOT v_is_dev THEN v_outlet_id := public.guest_arrival_current_outlet(); END IF;
  IF p_status NOT IN ('Selesai','Batalkan') THEN
    RAISE EXCEPTION 'Status tindakan tidak valid.' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row FROM public.guest_arrivals
  WHERE id=p_id AND (v_is_dev OR outlet_id=v_outlet_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data tamu tidak ditemukan.' USING ERRCODE='P0002'; END IF;
  IF v_row.status<>'Menunggu' THEN
    RAISE EXCEPTION 'Tamu sudah tidak berstatus Menunggu; tindakan biasa tidak dapat mengubah status final.'
      USING ERRCODE='55000';
  END IF;

  v_before := public.guest_arrival_row_json(v_row);
  v_now := clock_timestamp();
  UPDATE public.guest_arrivals
  SET status=p_status,
      finished_at=v_now,
      waiting_seconds=GREATEST(0,floor(extract(epoch FROM (v_now-arrived_at)))::integer),
      cancellation_reason=CASE WHEN p_status='Batalkan' THEN NULLIF(btrim(COALESCE(p_reason,'')),'') ELSE NULL END
  WHERE id=p_id
  RETURNING * INTO v_row;

  v_after := public.guest_arrival_row_json(v_row);
  INSERT INTO public.guest_arrival_changes(guest_arrival_id,actor_id,actor_email,change_type,reason,old_data,new_data)
  VALUES(v_row.id,auth.uid(),lower(COALESCE(auth.jwt()->>'email','unknown')),'STATUS',
         NULLIF(btrim(COALESCE(p_reason,'')),''),v_before,v_after);
  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_correct(
  p_id uuid,p_name text,p_packs integer,p_whatsapp text,p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
DECLARE
  v_row public.guest_arrivals;
  v_before jsonb;
  v_after jsonb;
  v_is_dev boolean;
  v_outlet_id uuid;
BEGIN
  PERFORM public.guest_arrival_assert_access();
  v_is_dev := public.app_role()='dev';
  IF NOT v_is_dev THEN v_outlet_id := public.guest_arrival_current_outlet(); END IF;

  IF p_name IS NULL OR length(btrim(p_name))=0 THEN
    RAISE EXCEPTION 'Nama tamu wajib diisi.' USING ERRCODE='22023';
  END IF;
  IF p_packs IS NULL OR p_packs<1 THEN
    RAISE EXCEPTION 'Jumlah pack minimal 1.' USING ERRCODE='22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))=0 THEN
    RAISE EXCEPTION 'Alasan koreksi wajib diisi.' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row FROM public.guest_arrivals
  WHERE id=p_id AND (v_is_dev OR outlet_id=v_outlet_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data tamu tidak ditemukan.' USING ERRCODE='P0002'; END IF;

  v_before := public.guest_arrival_row_json(v_row);
  UPDATE public.guest_arrivals
  SET guest_name=btrim(p_name),packs=p_packs,whatsapp=NULLIF(btrim(COALESCE(p_whatsapp,'')),'')
  WHERE id=p_id
  RETURNING * INTO v_row;

  v_after := public.guest_arrival_row_json(v_row);
  INSERT INTO public.guest_arrival_changes(guest_arrival_id,actor_id,actor_email,change_type,reason,old_data,new_data)
  VALUES(v_row.id,auth.uid(),lower(COALESCE(auth.jwt()->>'email','unknown')),'CORRECTION',
         btrim(p_reason),v_before,v_after);
  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_dashboard(p_from date,p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
DECLARE
  v_result jsonb;
  v_is_dev boolean;
  v_outlet_id uuid;
BEGIN
  PERFORM public.guest_arrival_assert_access();
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN
    RAISE EXCEPTION 'Rentang tanggal tidak valid.' USING ERRCODE='22023';
  END IF;
  v_is_dev := public.app_role()='dev';
  IF NOT v_is_dev THEN v_outlet_id := public.guest_arrival_current_outlet(); END IF;

  SELECT jsonb_build_object(
    'from_date',p_from,'to_date',p_to,
    'total_registrations',count(*),
    'total_packs',COALESCE(sum(g.packs),0),
    'completed_count',count(*) FILTER(WHERE g.status='Selesai'),
    'waiting_count',count(*) FILTER(WHERE g.status='Menunggu'),
    'cancelled_count',count(*) FILTER(WHERE g.status='Batalkan'),
    'completed_packs',COALESCE(sum(g.packs) FILTER(WHERE g.status='Selesai'),0),
    'waiting_packs',COALESCE(sum(g.packs) FILTER(WHERE g.status='Menunggu'),0),
    'cancelled_packs',COALESCE(sum(g.packs) FILTER(WHERE g.status='Batalkan'),0),
    'avg_waiting_seconds',COALESCE(round(avg(g.waiting_seconds) FILTER(
      WHERE g.status IN ('Selesai','Batalkan') AND g.waiting_seconds IS NOT NULL))::integer,0),
    'longest_waiting_seconds',COALESCE(max(g.waiting_seconds) FILTER(
      WHERE g.status IN ('Selesai','Batalkan') AND g.waiting_seconds IS NOT NULL),0),
    'monthly',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month',to_char(m.month_start,'YYYY-MM'),
        'total_registrations',m.total_registrations,'total_packs',m.total_packs,
        'completed_count',m.completed_count,'waiting_count',m.waiting_count,
        'cancelled_count',m.cancelled_count,'completed_packs',m.completed_packs,
        'waiting_packs',m.waiting_packs,'cancelled_packs',m.cancelled_packs
      ) ORDER BY m.month_start)
      FROM (
        SELECT date_trunc('month',g2.operational_date)::date AS month_start,
          count(*) AS total_registrations,COALESCE(sum(g2.packs),0) AS total_packs,
          count(*) FILTER(WHERE g2.status='Selesai') AS completed_count,
          count(*) FILTER(WHERE g2.status='Menunggu') AS waiting_count,
          count(*) FILTER(WHERE g2.status='Batalkan') AS cancelled_count,
          COALESCE(sum(g2.packs) FILTER(WHERE g2.status='Selesai'),0) AS completed_packs,
          COALESCE(sum(g2.packs) FILTER(WHERE g2.status='Menunggu'),0) AS waiting_packs,
          COALESCE(sum(g2.packs) FILTER(WHERE g2.status='Batalkan'),0) AS cancelled_packs
        FROM public.guest_arrivals g2
        WHERE g2.operational_date BETWEEN p_from AND p_to
          AND (v_is_dev OR g2.outlet_id=v_outlet_id)
        GROUP BY date_trunc('month',g2.operational_date)::date
      ) m
    ),'[]'::jsonb)
  )
  INTO v_result
  FROM public.guest_arrivals g
  WHERE g.operational_date BETWEEN p_from AND p_to
    AND (v_is_dev OR g.outlet_id=v_outlet_id);

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_export(p_from date,p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','auth'
AS $function$
DECLARE
  v_details jsonb;
  v_cancellations jsonb;
  v_summary jsonb;
  v_is_dev boolean;
  v_outlet_id uuid;
BEGIN
  PERFORM public.guest_arrival_assert_access();
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN
    RAISE EXCEPTION 'Rentang tanggal tidak valid.' USING ERRCODE='22023';
  END IF;
  v_is_dev := public.app_role()='dev';
  IF NOT v_is_dev THEN v_outlet_id := public.guest_arrival_current_outlet(); END IF;

  SELECT COALESCE(jsonb_agg(public.guest_arrival_row_json(g) ORDER BY g.operational_date,g.queue_number),'[]'::jsonb)
  INTO v_details
  FROM public.guest_arrivals g
  WHERE g.operational_date BETWEEN p_from AND p_to
    AND (v_is_dev OR g.outlet_id=v_outlet_id);

  SELECT COALESCE(jsonb_agg(public.guest_arrival_row_json(g) ORDER BY g.operational_date,g.queue_number),'[]'::jsonb)
  INTO v_cancellations
  FROM public.guest_arrivals g
  WHERE g.operational_date BETWEEN p_from AND p_to
    AND g.status='Batalkan'
    AND (v_is_dev OR g.outlet_id=v_outlet_id);

  v_summary := public.guest_arrival_dashboard(p_from,p_to);
  RETURN jsonb_build_object('details',v_details,'cancellations',v_cancellations,'summary',v_summary);
END;
$function$;

-- Enforce outlet-aware row visibility for any direct table reads.
DROP POLICY IF EXISTS guest_arrivals_select_authorized ON public.guest_arrivals;
CREATE POLICY guest_arrivals_select_authorized
  ON public.guest_arrivals FOR SELECT TO authenticated
  USING (
    public.guest_arrival_can_access()
    AND (
      public.app_role()='dev'
      OR outlet_id=public.guest_arrival_current_outlet()
    )
  );

DROP POLICY IF EXISTS guest_arrival_changes_select_authorized ON public.guest_arrival_changes;
CREATE POLICY guest_arrival_changes_select_authorized
  ON public.guest_arrival_changes FOR SELECT TO authenticated
  USING (
    public.guest_arrival_can_access()
    AND EXISTS (
      SELECT 1
      FROM public.guest_arrivals g
      WHERE g.id=guest_arrival_changes.guest_arrival_id
        AND (public.app_role()='dev' OR g.outlet_id=public.guest_arrival_current_outlet())
    )
  );

-- Keep helper functions non-public. Expose only the scoped context/current-outlet and RPCs to signed-in users.
REVOKE ALL ON FUNCTION public.guest_arrival_can_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_arrival_can_access() TO authenticated;
REVOKE ALL ON FUNCTION public.guest_arrival_current_outlet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_arrival_current_outlet() TO authenticated;
REVOKE ALL ON FUNCTION public.guest_arrival_assert_access() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guest_arrival_row_json(public.guest_arrivals) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guest_arrival_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_arrival_context() TO authenticated;

REVOKE ALL ON FUNCTION public.guest_arrival_create(text,integer,text,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_list(text,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_set_status(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_correct(uuid,text,integer,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_dashboard(date,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_export(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_arrival_create(text,integer,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_list(text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_set_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_correct(uuid,text,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_dashboard(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_export(date,date) TO authenticated;

COMMIT;