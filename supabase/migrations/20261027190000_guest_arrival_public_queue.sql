-- Guest Arrival Public Queue: separate token-only entry point; no anon table/RPC access.
ALTER TABLE public.guest_arrivals
  ADD COLUMN IF NOT EXISTS registration_source text NOT NULL DEFAULT 'admin';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.guest_arrivals'::regclass
      AND conname='guest_arrivals_registration_source_check'
  ) THEN
    ALTER TABLE public.guest_arrivals ADD CONSTRAINT guest_arrivals_registration_source_check
      CHECK (registration_source IN ('admin','public'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.guest_arrival_public_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS guest_arrival_public_links_one_active_per_outlet
  ON public.guest_arrival_public_links(outlet_id) WHERE active AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.guest_arrival_public_rate_limits (
  link_id uuid NOT NULL REFERENCES public.guest_arrival_public_links(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (link_id, window_start)
);

ALTER TABLE public.guest_arrival_public_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_arrival_public_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_arrival_public_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guest_arrival_public_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_arrival_public_links TO service_role;
GRANT ALL ON TABLE public.guest_arrival_public_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.guest_arrival_public_link_manage(p_action text, p_outlet_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','auth','extensions'
AS $function$
DECLARE
  v_is_dev boolean;
  v_outlet_id uuid;
  v_outlet_code text;
  v_outlet_name text;
  v_token text;
  v_link_id uuid;
  v_revoked_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.role(),'') <> 'authenticated' THEN
    RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE='42501';
  END IF;
  IF NOT public.guest_arrival_can_access() THEN
    RAISE EXCEPTION 'Akses Guest Arrival ditolak.' USING ERRCODE='42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('create','revoke') THEN
    RAISE EXCEPTION 'Aksi link publik tidak valid.' USING ERRCODE='22023';
  END IF;

  v_is_dev := public.app_role()='dev';
  IF v_is_dev THEN
    IF p_outlet_id IS NULL THEN
      RAISE EXCEPTION 'Pilih satu outlet aktif terlebih dahulu.' USING ERRCODE='22023';
    END IF;
    SELECT o.id,o.code,o.name INTO v_outlet_id,v_outlet_code,v_outlet_name
    FROM public.outlets o WHERE o.id=p_outlet_id AND o.active;
  ELSE
    v_outlet_id := COALESCE(p_outlet_id, public.guest_arrival_current_outlet());
    IF v_outlet_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_scopes s
      JOIN public.outlets o ON o.id=s.outlet_id AND o.active
      WHERE s.user_id=auth.uid() AND s.outlet_id=v_outlet_id
    ) THEN
      SELECT o.id,o.code,o.name INTO v_outlet_id,v_outlet_code,v_outlet_name
      FROM public.outlets o WHERE o.id=v_outlet_id AND o.active;
    ELSE
      v_outlet_id := NULL;
    END IF;
  END IF;

  IF v_outlet_id IS NULL THEN
    RAISE EXCEPTION 'Outlet tidak ditemukan, tidak aktif, atau di luar akses akun.' USING ERRCODE='42501';
  END IF;

  IF p_action='revoke' THEN
    UPDATE public.guest_arrival_public_links
    SET active=false,revoked_at=clock_timestamp()
    WHERE outlet_id=v_outlet_id AND active AND revoked_at IS NULL;
    GET DIAGNOSTICS v_revoked_count = ROW_COUNT;
    RETURN jsonb_build_object('ok',true,'revoked',v_revoked_count>0,'outlet_code',v_outlet_code,'outlet_name',v_outlet_name);
  END IF;

  -- Replacing the QR revokes the previous token. Plaintext token is returned once.
  UPDATE public.guest_arrival_public_links
  SET active=false,revoked_at=clock_timestamp()
  WHERE outlet_id=v_outlet_id AND active AND revoked_at IS NULL;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.guest_arrival_public_links(outlet_id,token_hash,created_by)
  VALUES(v_outlet_id,encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid())
  RETURNING id INTO v_link_id;

  RETURN jsonb_build_object('ok',true,'token',v_token,'outlet_code',v_outlet_code,'outlet_name',v_outlet_name,'link_id',v_link_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_public_outlet(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','auth','extensions'
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'Akses endpoint publik tidak valid.' USING ERRCODE='42501';
  END IF;
  IF p_token IS NULL OR p_token !~ '^[a-fA-F0-9]{64}$' THEN
    RAISE EXCEPTION 'Link antrean tidak valid atau sudah dinonaktifkan.' USING ERRCODE='P0002';
  END IF;
  SELECT jsonb_build_object('outlet_code',o.code,'outlet_name',o.name) INTO v_result
  FROM public.guest_arrival_public_links l
  JOIN public.outlets o ON o.id=l.outlet_id AND o.active
  WHERE l.token_hash=encode(extensions.digest(lower(p_token),'sha256'),'hex')
    AND l.active AND l.revoked_at IS NULL;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Link antrean tidak valid atau sudah dinonaktifkan.' USING ERRCODE='P0002';
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_public_create(
  p_token text,p_name text,p_packs integer,p_whatsapp text,p_smoking_preference text,p_note text,p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','auth','extensions'
AS $function$
DECLARE
  v_link public.guest_arrival_public_links;
  v_outlet_code text;
  v_outlet_name text;
  v_existing public.guest_arrivals;
  v_now timestamptz;
  v_date date;
  v_number integer;
  v_count integer;
  v_row public.guest_arrivals;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'Akses endpoint publik tidak valid.' USING ERRCODE='42501';
  END IF;
  IF p_token IS NULL OR p_token !~ '^[a-fA-F0-9]{64}$' THEN
    RAISE EXCEPTION 'Link antrean tidak valid atau sudah dinonaktifkan.' USING ERRCODE='P0002';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'ID permintaan tidak valid.' USING ERRCODE='22023'; END IF;
  IF p_name IS NULL OR length(btrim(p_name))<2 OR length(btrim(p_name))>80 THEN
    RAISE EXCEPTION 'Nama harus diisi, maksimal 80 karakter.' USING ERRCODE='22023';
  END IF;
  IF p_packs IS NULL OR p_packs<1 OR p_packs>50 THEN
    RAISE EXCEPTION 'Jumlah tamu harus antara 1 sampai 50 orang.' USING ERRCODE='22023';
  END IF;
  IF length(btrim(COALESCE(p_whatsapp,'')))>32 THEN
    RAISE EXCEPTION 'Nomor kontak terlalu panjang.' USING ERRCODE='22023';
  END IF;
  IF length(btrim(COALESCE(p_note,'')))>300 THEN
    RAISE EXCEPTION 'Catatan maksimal 300 karakter.' USING ERRCODE='22023';
  END IF;
  IF COALESCE(p_smoking_preference,'') NOT IN ('Non Smoking','Smoking') THEN
    RAISE EXCEPTION 'Preferensi smoking tidak valid.' USING ERRCODE='22023';
  END IF;

  SELECT l.* INTO v_link
  FROM public.guest_arrival_public_links l
  JOIN public.outlets o ON o.id=l.outlet_id AND o.active
  WHERE l.token_hash=encode(extensions.digest(lower(p_token),'sha256'),'hex')
    AND l.active AND l.revoked_at IS NULL
  FOR UPDATE OF l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link antrean tidak valid atau sudah dinonaktifkan.' USING ERRCODE='P0002';
  END IF;

  SELECT o.code,o.name INTO v_outlet_code,v_outlet_name
  FROM public.outlets o WHERE o.id=v_link.outlet_id AND o.active;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  SELECT * INTO v_existing FROM public.guest_arrivals WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.outlet_id IS DISTINCT FROM v_link.outlet_id
       OR v_existing.registration_source IS DISTINCT FROM 'public' THEN
      RAISE EXCEPTION 'Permintaan ini tidak dapat digunakan kembali.' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object(
      'ok',true,'queue_number',v_existing.queue_number,
      'queue_code','WL-'||lpad(v_existing.queue_number::text,3,'0'),
      'status',v_existing.status,'operational_date',v_existing.operational_date,
      'outlet_code',v_outlet_code,'outlet_name',v_outlet_name,'duplicate_request',true
    );
  END IF;

  v_now := clock_timestamp();
  v_date := (v_now AT TIME ZONE 'Asia/Jakarta')::date;
  INSERT INTO public.guest_arrival_public_rate_limits(link_id,window_start,request_count)
  VALUES(v_link.id,date_trunc('minute',v_now),1)
  ON CONFLICT(link_id,window_start)
  DO UPDATE SET request_count=public.guest_arrival_public_rate_limits.request_count+1
  RETURNING request_count INTO v_count;
  IF v_count>30 THEN
    RAISE EXCEPTION 'Terlalu banyak permintaan. Coba lagi dalam satu menit.' USING ERRCODE='P0001';
  END IF;
  IF v_count=1 THEN
    DELETE FROM public.guest_arrival_public_rate_limits
    WHERE window_start < date_trunc('minute',v_now)-interval '2 days';
  END IF;

  INSERT INTO public.guest_arrival_daily_counters(outlet_id,operational_date,last_number)
  VALUES(v_link.outlet_id,v_date,0)
  ON CONFLICT(outlet_id,operational_date) DO NOTHING;
  UPDATE public.guest_arrival_daily_counters
  SET last_number=last_number+1,updated_at=v_now
  WHERE outlet_id=v_link.outlet_id AND operational_date=v_date
  RETURNING last_number INTO v_number;

  INSERT INTO public.guest_arrivals(
    outlet_id,operational_date,queue_number,guest_name,packs,whatsapp,
    smoking_preference,note,arrived_at,status,finished_at,waiting_seconds,
    cancellation_reason,request_id,created_by,created_by_email,registration_source
  )
  VALUES(
    v_link.outlet_id,v_date,v_number,btrim(p_name),p_packs,
    NULLIF(btrim(COALESCE(p_whatsapp,'')),''),
    p_smoking_preference,NULLIF(btrim(COALESCE(p_note,'')),''),
    v_now,'Menunggu',NULL,NULL,NULL,p_request_id,NULL,'public-web','public'
  )
  RETURNING * INTO v_row;

  -- Allow-list only: no name, phone, note, internal row UUID, or audit data.
  RETURN jsonb_build_object(
    'ok',true,'queue_number',v_row.queue_number,
    'queue_code','WL-'||lpad(v_row.queue_number::text,3,'0'),
    'status',v_row.status,'operational_date',v_row.operational_date,
    'outlet_code',v_outlet_code,'outlet_name',v_outlet_name,'duplicate_request',false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.guest_arrival_public_link_manage(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_public_link_manage(text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.guest_arrival_public_outlet(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_public_outlet(text) TO service_role;
REVOKE ALL ON FUNCTION public.guest_arrival_public_create(text,text,integer,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_public_create(text,text,integer,text,text,text,uuid) TO service_role;

COMMENT ON TABLE public.guest_arrival_public_links IS 'Hash-only tokens for guest-facing queue registration. Plain token returned once to an authorized admin.';
COMMENT ON TABLE public.guest_arrival_public_rate_limits IS 'Per-link minute buckets to limit public queue registration attempts.';

-- Preserve the source marker in every existing Guest Arrival list/detail/export payload.
-- This keeps the admin badge and export column in sync without changing existing fields.
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
    'smoking_preference', p_row.smoking_preference,
    'note', p_row.note,
    'registration_source', p_row.registration_source,
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

