CREATE OR REPLACE FUNCTION public.guest_arrival_create(
  p_name text,
  p_packs integer,
  p_whatsapp text,
  p_initial_status text,
  p_request_id uuid,
  p_outlet_id uuid DEFAULT NULL::uuid,
  p_smoking_preference text DEFAULT 'Non Smoking'::text,
  p_note text DEFAULT NULL::text,
  p_table_name text DEFAULT NULL::text
)
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
  v_table_name text;
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
    RAISE EXCEPTION 'Outlet Guest Arrival tidak ditemukan atau tidak aktif.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Permintaan pendaftaran tidak memiliki ID idempotensi.' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Nama tamu wajib diisi.' USING ERRCODE = '22023';
  END IF;
  IF p_packs IS NULL OR p_packs < 1 THEN
    RAISE EXCEPTION 'Jumlah pack minimal 1.' USING ERRCODE = '22023';
  END IF;
  IF p_initial_status NOT IN ('Menunggu', 'Duduk') THEN
    RAISE EXCEPTION 'Status awal hanya boleh Menunggu atau Duduk.' USING ERRCODE = '22023';
  END IF;
  IF p_initial_status='Duduk' AND (p_table_name IS NULL OR length(btrim(p_table_name))=0) THEN
    RAISE EXCEPTION 'Nomor atau nama meja wajib diisi untuk status Duduk.' USING ERRCODE = '22023';
  END IF;
  IF p_initial_status='Duduk' AND length(btrim(p_table_name))>80 THEN
    RAISE EXCEPTION 'Nomor atau nama meja maksimal 80 karakter.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_smoking_preference, '') NOT IN ('Non Smoking', 'Smoking') THEN
    RAISE EXCEPTION 'Preferensi smoking tidak valid.' USING ERRCODE = '22023';
  END IF;
  v_table_name := CASE WHEN p_initial_status='Duduk' THEN btrim(p_table_name) ELSE NULL END;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT * INTO v_row FROM public.guest_arrivals WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_row.outlet_id IS DISTINCT FROM v_outlet_id THEN
      RAISE EXCEPTION 'Permintaan pendaftaran ini sudah dipakai di outlet lain.' USING ERRCODE = '42501';
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
    outlet_id, operational_date, queue_number, guest_name, packs, whatsapp,
    smoking_preference, note, arrived_at, status, table_name, seated_at,
    finished_at, waiting_seconds, cancellation_reason, request_id, created_by, created_by_email
  )
  VALUES (
    v_outlet_id, v_date, v_number, btrim(p_name), p_packs,
    NULLIF(btrim(COALESCE(p_whatsapp,'')), ''),
    p_smoking_preference,
    NULLIF(btrim(COALESCE(p_note,'')), ''),
    v_now, p_initial_status, v_table_name,
    CASE WHEN p_initial_status='Duduk' THEN v_now ELSE NULL END,
    NULL,
    CASE WHEN p_initial_status='Duduk' THEN 0 ELSE NULL END,
    NULL, p_request_id, auth.uid(), lower(COALESCE(auth.jwt()->>'email','unknown'))
  )
  RETURNING * INTO v_row;

  RETURN public.guest_arrival_row_json(v_row) || jsonb_build_object('duplicate_request', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.guest_arrival_create(text,integer,text,text,uuid,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guest_arrival_create(text,integer,text,text,uuid,uuid,text,text,text) TO authenticated;
