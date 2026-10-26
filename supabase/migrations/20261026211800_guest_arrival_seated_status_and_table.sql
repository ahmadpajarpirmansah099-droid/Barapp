-- Guest Arrival: introduce seated status, manually recorded table, and audit-safe transitions.
-- This migration is scoped by the existing Guest Arrival RPC access/outlet checks.
ALTER TABLE public.guest_arrivals
  ADD COLUMN IF NOT EXISTS table_name text,
  ADD COLUMN IF NOT EXISTS seated_at timestamptz;

ALTER TABLE public.guest_arrivals
  DROP CONSTRAINT IF EXISTS guest_arrivals_status_check,
  DROP CONSTRAINT IF EXISTS guest_arrivals_wait_state_check;

ALTER TABLE public.guest_arrivals
  ADD CONSTRAINT guest_arrivals_status_check
    CHECK (status = ANY (ARRAY['Menunggu'::text, 'Duduk'::text, 'Selesai'::text, 'Batalkan'::text])),
  ADD CONSTRAINT guest_arrivals_wait_state_check
    CHECK (
      (status='Menunggu' AND seated_at IS NULL AND table_name IS NULL AND finished_at IS NULL AND waiting_seconds IS NULL)
      OR
      (status='Duduk' AND seated_at IS NOT NULL AND table_name IS NOT NULL AND length(btrim(table_name)) BETWEEN 1 AND 80
        AND finished_at IS NULL AND waiting_seconds IS NOT NULL AND waiting_seconds >= 0)
      OR
      (status='Selesai' AND finished_at IS NOT NULL AND waiting_seconds IS NOT NULL AND waiting_seconds >= 0
        AND ((seated_at IS NULL AND table_name IS NULL)
          OR (seated_at IS NOT NULL AND table_name IS NOT NULL AND length(btrim(table_name)) BETWEEN 1 AND 80)))
      OR
      (status='Batalkan' AND seated_at IS NULL AND table_name IS NULL
        AND finished_at IS NOT NULL AND waiting_seconds IS NOT NULL AND waiting_seconds >= 0)
    );

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
    'seated_count',count(*) FILTER(WHERE g.status='Duduk'),
    'cancelled_count',count(*) FILTER(WHERE g.status='Batalkan'),
    'completed_packs',COALESCE(sum(g.packs) FILTER(WHERE g.status='Selesai'),0),
    'waiting_packs',COALESCE(sum(g.packs) FILTER(WHERE g.status='Menunggu'),0),
    'seated_packs',COALESCE(sum(g.packs) FILTER(WHERE g.status='Duduk'),0),
    'cancelled_packs',COALESCE(sum(g.packs) FILTER(WHERE g.status='Batalkan'),0),
    'avg_waiting_seconds',COALESCE(round(avg(g.waiting_seconds) FILTER(
      WHERE g.status IN ('Duduk','Selesai','Batalkan') AND g.waiting_seconds IS NOT NULL))::integer,0),
    'longest_waiting_seconds',COALESCE(max(g.waiting_seconds) FILTER(
      WHERE g.status IN ('Duduk','Selesai','Batalkan') AND g.waiting_seconds IS NOT NULL),0),
    'monthly',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month',to_char(m.month_start,'YYYY-MM'),
        'total_registrations',m.total_registrations,'total_packs',m.total_packs,
        'completed_count',m.completed_count,'waiting_count',m.waiting_count,
        'seated_count',m.seated_count,'cancelled_count',m.cancelled_count,
        'completed_packs',m.completed_packs,'waiting_packs',m.waiting_packs,
        'seated_packs',m.seated_packs,'cancelled_packs',m.cancelled_packs
      ) ORDER BY m.month_start)
      FROM (
        SELECT date_trunc('month',g2.operational_date)::date AS month_start,
          count(*) AS total_registrations,COALESCE(sum(g2.packs),0) AS total_packs,
          count(*) FILTER(WHERE g2.status='Selesai') AS completed_count,
          count(*) FILTER(WHERE g2.status='Menunggu') AS waiting_count,
          count(*) FILTER(WHERE g2.status='Duduk') AS seated_count,
          count(*) FILTER(WHERE g2.status='Batalkan') AS cancelled_count,
          COALESCE(sum(g2.packs) FILTER(WHERE g2.status='Selesai'),0) AS completed_packs,
          COALESCE(sum(g2.packs) FILTER(WHERE g2.status='Menunggu'),0) AS waiting_packs,
          COALESCE(sum(g2.packs) FILTER(WHERE g2.status='Duduk'),0) AS seated_packs,
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
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_finish_seated(p_id uuid, p_outlet_id uuid DEFAULT NULL::uuid)
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
      SELECT 1 FROM public.outlets o WHERE o.id=p_outlet_id AND o.active
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
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data tamu tidak ditemukan.' USING ERRCODE='P0002';
  END IF;
  IF v_row.status<>'Duduk' THEN
    RAISE EXCEPTION 'Hanya tamu berstatus Duduk yang dapat diselesaikan.' USING ERRCODE='55000';
  END IF;

  v_before := public.guest_arrival_row_json(v_row);
  v_now := clock_timestamp();
  UPDATE public.guest_arrivals
  SET status='Selesai',
      finished_at=v_now,
      waiting_seconds=COALESCE(v_row.waiting_seconds,
        GREATEST(0,floor(extract(epoch FROM (COALESCE(v_row.seated_at,v_now)-v_row.arrived_at)))::integer)),
      cancellation_reason=NULL
  WHERE id=p_id
  RETURNING * INTO v_row;

  v_after := public.guest_arrival_row_json(v_row);
  INSERT INTO public.guest_arrival_changes(guest_arrival_id,actor_id,actor_email,change_type,reason,old_data,new_data)
  VALUES(v_row.id,auth.uid(),lower(COALESCE(auth.jwt()->>'email','unknown')),'STATUS',
         'Pelayanan selesai setelah duduk di meja: ' || COALESCE(v_row.table_name,'—'),v_before,v_after);
  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_row_json(p_row guest_arrivals)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
    'smoking_preference', p_row.smoking_preference,
    'note', p_row.note,
    'arrived_at', p_row.arrived_at,
    'status', p_row.status,
    'table_name', p_row.table_name,
    'seated_at', p_row.seated_at,
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

CREATE OR REPLACE FUNCTION public.guest_arrival_seated_list(p_outlet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
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
      SELECT 1 FROM public.outlets o WHERE o.id=p_outlet_id AND o.active
    ) THEN
      RAISE EXCEPTION 'Outlet yang dipilih tidak ditemukan atau tidak aktif.' USING ERRCODE='42501';
    END IF;
  ELSE
    v_outlet_id := public.guest_arrival_current_outlet();
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      public.guest_arrival_row_json(g) || jsonb_build_object('server_now',v_server_now)
      ORDER BY g.seated_at DESC NULLS LAST, g.operational_date DESC, g.queue_number DESC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.guest_arrivals g
  WHERE g.status='Duduk'
    AND (
      (v_is_dev AND (v_outlet_id IS NULL OR g.outlet_id=v_outlet_id))
      OR (NOT v_is_dev AND g.outlet_id=v_outlet_id)
    );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_set_seated(p_id uuid, p_table_name text, p_outlet_id uuid DEFAULT NULL::uuid)
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
      SELECT 1 FROM public.outlets o WHERE o.id=p_outlet_id AND o.active
    ) THEN
      RAISE EXCEPTION 'Outlet yang dipilih tidak ditemukan atau tidak aktif.' USING ERRCODE='42501';
    END IF;
  ELSE
    v_outlet_id := public.guest_arrival_current_outlet();
  END IF;

  IF p_table_name IS NULL OR length(btrim(p_table_name))=0 THEN
    RAISE EXCEPTION 'Nomor atau nama meja wajib diisi.' USING ERRCODE='22023';
  END IF;
  IF length(btrim(p_table_name))>80 THEN
    RAISE EXCEPTION 'Nomor atau nama meja maksimal 80 karakter.' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row
  FROM public.guest_arrivals g
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
    RAISE EXCEPTION 'Tamu sudah tidak berstatus Menunggu.' USING ERRCODE='55000';
  END IF;

  v_before := public.guest_arrival_row_json(v_row);
  v_now := clock_timestamp();
  UPDATE public.guest_arrivals
  SET status='Duduk',
      table_name=btrim(p_table_name),
      seated_at=v_now,
      finished_at=NULL,
      waiting_seconds=GREATEST(0,floor(extract(epoch FROM (v_now-arrived_at)))::integer),
      cancellation_reason=NULL
  WHERE id=p_id
  RETURNING * INTO v_row;

  v_after := public.guest_arrival_row_json(v_row);
  INSERT INTO public.guest_arrival_changes(guest_arrival_id,actor_id,actor_email,change_type,reason,old_data,new_data)
  VALUES(v_row.id,auth.uid(),lower(COALESCE(auth.jwt()->>'email','unknown')),'STATUS',
         'Tamu duduk di meja: ' || btrim(p_table_name),v_before,v_after);
  RETURN v_after;
END;
$function$;

REVOKE ALL ON FUNCTION public.guest_arrival_seated_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_set_seated(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_finish_seated(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_arrival_seated_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_set_seated(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_finish_seated(uuid,uuid) TO authenticated;
