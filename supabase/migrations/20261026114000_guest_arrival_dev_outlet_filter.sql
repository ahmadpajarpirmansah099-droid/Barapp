-- Developer-selected outlet scoping for Guest Arrival.
-- This migration preserves rows and constrains Guest Arrival RPC reads and mutations
-- to the outlet selected in the Barapp header when the caller is the developer.
-- Non-developer accounts continue using their assigned outlet scope.

BEGIN;

DROP FUNCTION IF EXISTS public.guest_arrival_export(date,date);
DROP FUNCTION IF EXISTS public.guest_arrival_dashboard(date,date);
DROP FUNCTION IF EXISTS public.guest_arrival_list(text,date);
DROP FUNCTION IF EXISTS public.guest_arrival_context();
DROP FUNCTION IF EXISTS public.guest_arrival_create(text,integer,text,text,uuid);
DROP FUNCTION IF EXISTS public.guest_arrival_detail(uuid);
DROP FUNCTION IF EXISTS public.guest_arrival_set_status(uuid,text,text);
DROP FUNCTION IF EXISTS public.guest_arrival_correct(uuid,text,integer,text,text);

CREATE OR REPLACE FUNCTION public.guest_arrival_context(p_outlet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_outlet_id uuid;
  v_result jsonb;
  v_is_dev boolean;
BEGIN
  PERFORM public.guest_arrival_assert_access();
  v_is_dev := public.app_role()='dev';

  IF v_is_dev THEN
    IF p_outlet_id IS NULL THEN
      RETURN jsonb_build_object(
        'is_developer', true,
        'outlet_id', NULL,
        'outlet_code', 'ALL',
        'outlet_name', 'Semua Outlet'
      );
    END IF;
    SELECT o.id INTO v_outlet_id
    FROM public.outlets o
    WHERE o.id=p_outlet_id AND o.active;
    IF v_outlet_id IS NULL THEN
      RAISE EXCEPTION 'Outlet yang dipilih tidak ditemukan atau tidak aktif.'
        USING ERRCODE='42501';
    END IF;
    SELECT jsonb_build_object(
      'is_developer', true,
      'outlet_id', o.id,
      'outlet_code', o.code,
      'outlet_name', o.name
    ) INTO v_result
    FROM public.outlets o
    WHERE o.id=v_outlet_id;
    RETURN v_result;
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
      USING ERRCODE='42501';
  END IF;
  RETURN v_result;
END;
$function$

CREATE OR REPLACE FUNCTION public.guest_arrival_correct(p_id uuid, p_name text, p_packs integer, p_whatsapp text, p_reason text, p_outlet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
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
  IF v_is_dev THEN
    v_outlet_id := p_outlet_id;
    IF v_outlet_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.outlets o WHERE o.id=v_outlet_id AND o.active
    ) THEN
      RAISE EXCEPTION 'Outlet yang dipilih tidak ditemukan atau tidak aktif.' USING ERRCODE='42501';
    END IF;
  ELSE
    v_outlet_id := public.guest_arrival_current_outlet();
  END IF;

  IF p_name IS NULL OR length(btrim(p_name))=0 THEN
    RAISE EXCEPTION 'Nama tamu wajib diisi.' USING ERRCODE='22023';
  END IF;
  IF p_packs IS NULL OR p_packs<1 THEN
    RAISE EXCEPTION 'Jumlah pack minimal 1.' USING ERRCODE='22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))=0 THEN
    RAISE EXCEPTION 'Alasan koreksi wajib diisi.' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row FROM public.guest_arrivals g
  WHERE g.id=p_id
    AND (
      (v_is_dev AND (v_outlet_id IS NULL OR g.outlet_id=v_outlet_id))
      OR (NOT v_is_dev AND g.outlet_id=v_outlet_id)
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data tamu tidak ditemukan.' USING ERRCODE='P0002';
  END IF;

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
$function$

CREATE OR REPLACE FUNCTION public.guest_arrival_create(p_name text, p_packs integer, p_whatsapp text, p_initial_status text, p_request_id uuid, p_outlet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
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
    IF p_outlet_id IS NULL THEN
      SELECT id INTO v_outlet_id FROM public.outlets WHERE code='LJN' AND active LIMIT 1;
    ELSE
      SELECT id INTO v_outlet_id FROM public.outlets WHERE id=p_outlet_id AND active;
    END IF;
  ELSE
    v_outlet_id := public.guest_arrival_current_outlet();
  END IF;
  IF v_outlet_id IS NULL THEN
    RAISE EXCEPTION 'Outlet Guest Arrival tidak ditemukan atau tidak aktif.'
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
    IF v_row.outlet_id IS DISTINCT FROM v_outlet_id THEN
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
$function$

CREATE OR REPLACE FUNCTION public.guest_arrival_dashboard(p_from date, p_to date, p_outlet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
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
  IF v_is_dev THEN
    v_outlet_id := p_outlet_id;
    IF v_outlet_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.outlets o WHERE o.id=v_outlet_id AND o.active
    ) THEN
      RAISE EXCEPTION 'Outlet yang dipilih tidak ditemukan atau tidak aktif.' USING ERRCODE='42501';
    END IF;
  ELSE
    v_outlet_id := public.guest_arrival_current_outlet();
  END IF;

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
          AND (
            (v_is_dev AND (v_outlet_id IS NULL OR g2.outlet_id=v_outlet_id))
            OR (NOT v_is_dev AND g2.outlet_id=v_outlet_id)
          )
        GROUP BY date_trunc('month',g2.operational_date)::date
      ) m
    ),'[]'::jsonb)
  )
  INTO v_result
  FROM public.guest_arrivals g
  WHERE g.operational_date BETWEEN p_from AND p_to
    AND (
      (v_is_dev AND (v_outlet_id IS NULL OR g.outlet_id=v_outlet_id))
      OR (NOT v_is_dev AND g.outlet_id=v_outlet_id)
    );

  RETURN v_result;
END;
$function$

CREATE OR REPLACE FUNCTION public.guest_arrival_detail(p_id uuid, p_outlet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_row public.guest_arrivals;
  v_result jsonb;
  v_is_dev boolean;
  v_outlet_id uuid;
BEGIN
  PERFORM public.guest_arrival_assert_access();
  v_is_dev := public.app_role()='dev';
  IF v_is_dev THEN
    v_outlet_id := p_outlet_id;
    IF v_outlet_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.outlets o WHERE o.id=v_outlet_id AND o.active
    ) THEN
      RAISE EXCEPTION 'Outlet yang dipilih tidak ditemukan atau tidak aktif.' USING ERRCODE='42501';
    END IF;
  ELSE
    v_outlet_id := public.guest_arrival_current_outlet();
  END IF;

  SELECT * INTO v_row
  FROM public.guest_arrivals g
  WHERE g.id=p_id
    AND (
      (v_is_dev AND (v_outlet_id IS NULL OR g.outlet_id=v_outlet_id))
      OR (NOT v_is_dev AND g.outlet_id=v_outlet_id)
    );
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
$function$

CREATE OR REPLACE FUNCTION public.guest_arrival_export(p_from date, p_to date, p_outlet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
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
  IF v_is_dev THEN
    v_outlet_id := p_outlet_id;
    IF v_outlet_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.outlets o WHERE o.id=v_outlet_id AND o.active
    ) THEN
      RAISE EXCEPTION 'Outlet yang dipilih tidak ditemukan atau tidak aktif.' USING ERRCODE='42501';
    END IF;
  ELSE
    v_outlet_id := public.guest_arrival_current_outlet();
  END IF;

  SELECT COALESCE(jsonb_agg(public.guest_arrival_row_json(g) ORDER BY g.operational_date,g.queue_number),'[]'::jsonb)
  INTO v_details
  FROM public.guest_arrivals g
  WHERE g.operational_date BETWEEN p_from AND p_to
    AND (
      (v_is_dev AND (v_outlet_id IS NULL OR g.outlet_id=v_outlet_id))
      OR (NOT v_is_dev AND g.outlet_id=v_outlet_id)
    );

  SELECT COALESCE(jsonb_agg(public.guest_arrival_row_json(g) ORDER BY g.operational_date,g.queue_number),'[]'::jsonb)
  INTO v_cancellations
  FROM public.guest_arrivals g
  WHERE g.operational_date BETWEEN p_from AND p_to
    AND g.status='Batalkan'
    AND (
      (v_is_dev AND (v_outlet_id IS NULL OR g.outlet_id=v_outlet_id))
      OR (NOT v_is_dev AND g.outlet_id=v_outlet_id)
    );

  v_summary := public.guest_arrival_dashboard(
    p_from,p_to,CASE WHEN v_is_dev THEN v_outlet_id ELSE NULL END
  );
  RETURN jsonb_build_object('details',v_details,'cancellations',v_cancellations,'summary',v_summary);
END;
$function$

CREATE OR REPLACE FUNCTION public.guest_arrival_list(p_scope text, p_date date DEFAULT NULL::date, p_outlet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
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
  IF v_is_dev THEN
    v_outlet_id := p_outlet_id;
    IF v_outlet_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.outlets o WHERE o.id=v_outlet_id AND o.active
    ) THEN
      RAISE EXCEPTION 'Outlet yang dipilih tidak ditemukan atau tidak aktif.' USING ERRCODE='42501';
    END IF;
  ELSE
    v_outlet_id := public.guest_arrival_current_outlet();
  END IF;

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
  AND (
    (v_is_dev AND (v_outlet_id IS NULL OR g.outlet_id=v_outlet_id))
    OR (NOT v_is_dev AND g.outlet_id=v_outlet_id)
  );

  RETURN v_result;
END;
$function$

CREATE OR REPLACE FUNCTION public.guest_arrival_set_status(p_id uuid, p_status text, p_reason text DEFAULT NULL::text, p_outlet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
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
  IF v_is_dev THEN
    v_outlet_id := p_outlet_id;
    IF v_outlet_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.outlets o WHERE o.id=v_outlet_id AND o.active
    ) THEN
      RAISE EXCEPTION 'Outlet yang dipilih tidak ditemukan atau tidak aktif.' USING ERRCODE='42501';
    END IF;
  ELSE
    v_outlet_id := public.guest_arrival_current_outlet();
  END IF;

  IF p_status NOT IN ('Selesai','Batalkan') THEN
    RAISE EXCEPTION 'Status tindakan tidak valid.' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row FROM public.guest_arrivals g
  WHERE g.id=p_id
    AND (
      (v_is_dev AND (v_outlet_id IS NULL OR g.outlet_id=v_outlet_id))
      OR (NOT v_is_dev AND g.outlet_id=v_outlet_id)
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data tamu tidak ditemukan.' USING ERRCODE='P0002';
  END IF;
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
$function$

REVOKE ALL ON FUNCTION public.guest_arrival_context(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_list(text,date,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_dashboard(date,date,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_export(date,date,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_create(text,integer,text,text,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_detail(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_set_status(uuid,text,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_correct(uuid,text,integer,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_arrival_context(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guest_arrival_list(text,date,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guest_arrival_dashboard(date,date,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guest_arrival_export(date,date,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guest_arrival_create(text,integer,text,text,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guest_arrival_detail(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guest_arrival_set_status(uuid,text,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guest_arrival_correct(uuid,text,integer,text,text,uuid) TO authenticated, service_role;

COMMIT;
