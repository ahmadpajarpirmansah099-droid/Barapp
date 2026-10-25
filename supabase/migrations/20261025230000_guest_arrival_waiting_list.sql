BEGIN;

SELECT set_config(
  'app.change_reason',
  'Provision dedicated Guest Arrival access for admin@div.service by explicit user instruction',
  true
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE lower(email) = 'admin@div.service'
  ) THEN
    RAISE EXCEPTION 'Supabase Auth account admin@div.service was not found; Guest Arrival migration stopped.';
  END IF;
END
$$;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role = ANY (ARRAY[
    'dev'::text,
    'hr'::text,
    'div_admin'::text,
    'legacy_admin'::text,
    'report_viewer'::text,
    'guest_arrival'::text
  ]));

INSERT INTO public.user_profiles (user_id, email, role, active)
SELECT id, email, 'guest_arrival', true
FROM auth.users
WHERE lower(email) = 'admin@div.service'
ON CONFLICT (user_id) DO UPDATE
SET email = EXCLUDED.email,
    role = 'guest_arrival',
    active = true;

CREATE TABLE public.guest_arrival_daily_counters (
  operational_date date PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.guest_arrivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operational_date date NOT NULL,
  queue_number integer NOT NULL CHECK (queue_number >= 1),
  guest_name text NOT NULL CHECK (length(btrim(guest_name)) > 0),
  packs integer NOT NULL CHECK (packs >= 1),
  whatsapp text,
  arrived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL CHECK (status IN ('Menunggu', 'Selesai', 'Batalkan')),
  finished_at timestamptz,
  waiting_seconds integer,
  cancellation_reason text,
  request_id uuid NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT guest_arrivals_operational_queue_unique UNIQUE (operational_date, queue_number),
  CONSTRAINT guest_arrivals_wait_state_check CHECK (
    (status = 'Menunggu' AND finished_at IS NULL AND waiting_seconds IS NULL)
    OR
    (status IN ('Selesai', 'Batalkan') AND finished_at IS NOT NULL AND waiting_seconds IS NOT NULL AND waiting_seconds >= 0)
  )
);

CREATE TABLE public.guest_arrival_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_arrival_id uuid NOT NULL REFERENCES public.guest_arrivals(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  change_type text NOT NULL CHECK (change_type IN ('CORRECTION', 'STATUS')),
  reason text,
  old_data jsonb NOT NULL,
  new_data jsonb NOT NULL
);

CREATE INDEX guest_arrivals_date_status_queue_idx
  ON public.guest_arrivals (operational_date, status, queue_number);

CREATE INDEX guest_arrivals_date_idx
  ON public.guest_arrivals (operational_date);

CREATE INDEX guest_arrival_changes_arrival_time_idx
  ON public.guest_arrival_changes (guest_arrival_id, changed_at DESC);

ALTER TABLE public.guest_arrival_daily_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_arrivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_arrival_changes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.guest_arrival_can_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    public.app_role() = 'dev'
    OR (
      public.app_role() = 'guest_arrival'
      AND lower(COALESCE(auth.jwt() ->> 'email', '')) = 'admin@div.service'
      AND EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.user_id = auth.uid()
          AND up.active
          AND up.role = 'guest_arrival'
          AND lower(up.email) = 'admin@div.service'
      )
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_assert_access()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.guest_arrival_can_access() THEN
    RAISE EXCEPTION 'Akses Guest Arrival ditolak.'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE POLICY guest_arrivals_select_authorized
  ON public.guest_arrivals
  FOR SELECT TO authenticated
  USING (public.guest_arrival_can_access());

CREATE POLICY guest_arrival_changes_select_authorized
  ON public.guest_arrival_changes
  FOR SELECT TO authenticated
  USING (public.guest_arrival_can_access());

REVOKE ALL ON TABLE public.guest_arrival_daily_counters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guest_arrivals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guest_arrival_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.guest_arrivals, public.guest_arrival_changes TO authenticated;

GRANT EXECUTE ON FUNCTION public.guest_arrival_can_access() TO authenticated;
REVOKE ALL ON FUNCTION public.guest_arrival_assert_access() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_arrival_row_json(p_row public.guest_arrivals)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', p_row.id,
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

REVOKE ALL ON FUNCTION public.guest_arrival_row_json(public.guest_arrivals) FROM PUBLIC, anon, authenticated;

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
SET search_path TO 'public'
AS $function$
DECLARE
  v_date date;
  v_now timestamptz;
  v_number integer;
  v_row public.guest_arrivals;
BEGIN
  PERFORM public.guest_arrival_assert_access();

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

  SELECT * INTO v_row
  FROM public.guest_arrivals
  WHERE request_id = p_request_id;

  IF FOUND THEN
    RETURN public.guest_arrival_row_json(v_row) || jsonb_build_object('duplicate_request', true);
  END IF;

  v_now := clock_timestamp();
  v_date := (v_now AT TIME ZONE 'Asia/Jakarta')::date;

  INSERT INTO public.guest_arrival_daily_counters (operational_date, last_number)
  VALUES (v_date, 0)
  ON CONFLICT (operational_date) DO NOTHING;

  UPDATE public.guest_arrival_daily_counters
  SET last_number = last_number + 1,
      updated_at = v_now
  WHERE operational_date = v_date
  RETURNING last_number INTO v_number;

  INSERT INTO public.guest_arrivals (
    operational_date, queue_number, guest_name, packs, whatsapp, arrived_at,
    status, finished_at, waiting_seconds, cancellation_reason, request_id,
    created_by, created_by_email
  )
  VALUES (
    v_date, v_number, btrim(p_name), p_packs, NULLIF(btrim(COALESCE(p_whatsapp, '')), ''),
    v_now, p_initial_status,
    CASE WHEN p_initial_status = 'Selesai' THEN v_now ELSE NULL END,
    CASE WHEN p_initial_status = 'Selesai' THEN 0 ELSE NULL END,
    NULL, p_request_id, auth.uid(), lower(COALESCE(auth.jwt() ->> 'email', 'unknown'))
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
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_date date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  v_server_now timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  PERFORM public.guest_arrival_assert_access();

  IF p_scope NOT IN ('today', 'pending', 'history') THEN
    RAISE EXCEPTION 'Mode daftar tamu tidak valid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    jsonb_agg(public.guest_arrival_row_json(g) || jsonb_build_object('server_now', v_server_now) ORDER BY g.operational_date, g.queue_number),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.guest_arrivals g
  WHERE
    (p_scope = 'today' AND g.operational_date = v_today AND g.status = 'Menunggu')
    OR (p_scope = 'pending' AND g.operational_date < v_today AND g.status = 'Menunggu')
    OR (p_scope = 'history' AND g.operational_date = v_date);

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_detail(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.guest_arrivals;
  v_result jsonb;
BEGIN
  PERFORM public.guest_arrival_assert_access();

  SELECT * INTO v_row FROM public.guest_arrivals WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data tamu tidak ditemukan.'
      USING ERRCODE = 'P0002';
  END IF;

  v_result := public.guest_arrival_row_json(v_row) || jsonb_build_object(
    'changes',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'change_type', c.change_type,
        'actor_email', c.actor_email,
        'changed_at', c.changed_at,
        'reason', c.reason,
        'old_data', c.old_data,
        'new_data', c.new_data
      ) ORDER BY c.changed_at DESC)
      FROM public.guest_arrival_changes c
      WHERE c.guest_arrival_id = v_row.id
    ), '[]'::jsonb)
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_set_status(
  p_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.guest_arrivals;
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz;
BEGIN
  PERFORM public.guest_arrival_assert_access();

  IF p_status NOT IN ('Selesai', 'Batalkan') THEN
    RAISE EXCEPTION 'Status tindakan tidak valid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.guest_arrivals
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data tamu tidak ditemukan.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status <> 'Menunggu' THEN
    RAISE EXCEPTION 'Tamu sudah tidak berstatus Menunggu; tindakan biasa tidak dapat mengubah status final.'
      USING ERRCODE = '55000';
  END IF;

  v_before := public.guest_arrival_row_json(v_row);
  v_now := clock_timestamp();

  UPDATE public.guest_arrivals
  SET status = p_status,
      finished_at = v_now,
      waiting_seconds = GREATEST(0, floor(extract(epoch FROM (v_now - arrived_at)))::integer),
      cancellation_reason = CASE WHEN p_status = 'Batalkan' THEN NULLIF(btrim(COALESCE(p_reason, '')), '') ELSE NULL END
  WHERE id = p_id
  RETURNING * INTO v_row;

  v_after := public.guest_arrival_row_json(v_row);

  INSERT INTO public.guest_arrival_changes (
    guest_arrival_id, actor_id, actor_email, change_type, reason, old_data, new_data
  )
  VALUES (
    v_row.id, auth.uid(), lower(COALESCE(auth.jwt() ->> 'email', 'unknown')),
    'STATUS', NULLIF(btrim(COALESCE(p_reason, '')), ''), v_before, v_after
  );

  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_correct(
  p_id uuid,
  p_name text,
  p_packs integer,
  p_whatsapp text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.guest_arrivals;
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM public.guest_arrival_assert_access();

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Nama tamu wajib diisi.'
      USING ERRCODE = '22023';
  END IF;
  IF p_packs IS NULL OR p_packs < 1 THEN
    RAISE EXCEPTION 'Jumlah pack minimal 1.'
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Alasan koreksi wajib diisi.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.guest_arrivals
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data tamu tidak ditemukan.'
      USING ERRCODE = 'P0002';
  END IF;

  v_before := public.guest_arrival_row_json(v_row);

  UPDATE public.guest_arrivals
  SET guest_name = btrim(p_name),
      packs = p_packs,
      whatsapp = NULLIF(btrim(COALESCE(p_whatsapp, '')), '')
  WHERE id = p_id
  RETURNING * INTO v_row;

  v_after := public.guest_arrival_row_json(v_row);

  INSERT INTO public.guest_arrival_changes (
    guest_arrival_id, actor_id, actor_email, change_type, reason, old_data, new_data
  )
  VALUES (
    v_row.id, auth.uid(), lower(COALESCE(auth.jwt() ->> 'email', 'unknown')),
    'CORRECTION', btrim(p_reason), v_before, v_after
  );

  RETURN public.guest_arrival_row_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_dashboard(
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.guest_arrival_assert_access();

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Rentang tanggal tidak valid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'from_date', p_from,
    'to_date', p_to,
    'total_registrations', count(*),
    'total_packs', COALESCE(sum(g.packs), 0),
    'completed_count', count(*) FILTER (WHERE g.status = 'Selesai'),
    'waiting_count', count(*) FILTER (WHERE g.status = 'Menunggu'),
    'cancelled_count', count(*) FILTER (WHERE g.status = 'Batalkan'),
    'completed_packs', COALESCE(sum(g.packs) FILTER (WHERE g.status = 'Selesai'), 0),
    'waiting_packs', COALESCE(sum(g.packs) FILTER (WHERE g.status = 'Menunggu'), 0),
    'cancelled_packs', COALESCE(sum(g.packs) FILTER (WHERE g.status = 'Batalkan'), 0),
    'avg_waiting_seconds', COALESCE(round(avg(g.waiting_seconds) FILTER (
      WHERE g.status IN ('Selesai', 'Batalkan') AND g.waiting_seconds IS NOT NULL
    ))::integer, 0),
    'longest_waiting_seconds', COALESCE(max(g.waiting_seconds) FILTER (
      WHERE g.status IN ('Selesai', 'Batalkan') AND g.waiting_seconds IS NOT NULL
    ), 0),
    'monthly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month', to_char(m.month_start, 'YYYY-MM'),
        'total_registrations', m.total_registrations,
        'total_packs', m.total_packs,
        'completed_count', m.completed_count,
        'waiting_count', m.waiting_count,
        'cancelled_count', m.cancelled_count,
        'completed_packs', m.completed_packs,
        'waiting_packs', m.waiting_packs,
        'cancelled_packs', m.cancelled_packs
      ) ORDER BY m.month_start)
      FROM (
        SELECT date_trunc('month', operational_date)::date AS month_start,
          count(*) AS total_registrations,
          COALESCE(sum(packs), 0) AS total_packs,
          count(*) FILTER (WHERE status = 'Selesai') AS completed_count,
          count(*) FILTER (WHERE status = 'Menunggu') AS waiting_count,
          count(*) FILTER (WHERE status = 'Batalkan') AS cancelled_count,
          COALESCE(sum(packs) FILTER (WHERE status = 'Selesai'), 0) AS completed_packs,
          COALESCE(sum(packs) FILTER (WHERE status = 'Menunggu'), 0) AS waiting_packs,
          COALESCE(sum(packs) FILTER (WHERE status = 'Batalkan'), 0) AS cancelled_packs
        FROM public.guest_arrivals
        WHERE operational_date BETWEEN p_from AND p_to
        GROUP BY date_trunc('month', operational_date)::date
      ) m
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.guest_arrivals g
  WHERE g.operational_date BETWEEN p_from AND p_to;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_export(
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_details jsonb;
  v_cancellations jsonb;
  v_summary jsonb;
BEGIN
  PERFORM public.guest_arrival_assert_access();

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Rentang tanggal tidak valid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(public.guest_arrival_row_json(g) ORDER BY g.operational_date, g.queue_number), '[]'::jsonb)
  INTO v_details
  FROM public.guest_arrivals g
  WHERE g.operational_date BETWEEN p_from AND p_to;

  SELECT COALESCE(jsonb_agg(public.guest_arrival_row_json(g) ORDER BY g.operational_date, g.queue_number), '[]'::jsonb)
  INTO v_cancellations
  FROM public.guest_arrivals g
  WHERE g.operational_date BETWEEN p_from AND p_to
    AND g.status = 'Batalkan';

  v_summary := public.guest_arrival_dashboard(p_from, p_to);

  RETURN jsonb_build_object(
    'details', v_details,
    'cancellations', v_cancellations,
    'summary', v_summary
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_reject_change_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Riwayat perubahan Guest Arrival bersifat permanen.'
    USING ERRCODE = '55000';
END;
$function$;

REVOKE ALL ON FUNCTION public.guest_arrival_reject_change_mutation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guest_arrival_changes_immutable
  BEFORE UPDATE OR DELETE ON public.guest_arrival_changes
  FOR EACH ROW EXECUTE FUNCTION public.guest_arrival_reject_change_mutation();

REVOKE ALL ON FUNCTION public.guest_arrival_create(text, integer, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_list(text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_set_status(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_correct(uuid, text, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_dashboard(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guest_arrival_export(date, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.guest_arrival_create(text, integer, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_list(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_set_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_correct(uuid, text, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_dashboard(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_export(date, date) TO authenticated;

COMMIT;