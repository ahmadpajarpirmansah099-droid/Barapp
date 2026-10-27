-- Guest Arrival: per-guest view-only ticket links.
-- Admin creates the queue entry first; each link can only view that existing ticket.
CREATE TABLE IF NOT EXISTS public.guest_arrival_public_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_arrival_id uuid NOT NULL REFERENCES public.guest_arrivals(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS guest_arrival_public_links_one_active_per_guest
  ON public.guest_arrival_public_links(guest_arrival_id)
  WHERE active AND revoked_at IS NULL;

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

CREATE OR REPLACE FUNCTION public.guest_arrival_guest_link_manage(
  p_action text, p_guest_arrival_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','auth','extensions'
AS $function$
DECLARE
  v_is_dev boolean;
  v_guest_id uuid;
  v_outlet_id uuid;
  v_outlet_code text;
  v_outlet_name text;
  v_queue_number integer;
  v_guest_name text;
  v_packs integer;
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
  IF p_action IS NULL OR p_action NOT IN ('create','revoke') OR p_guest_arrival_id IS NULL THEN
    RAISE EXCEPTION 'Aksi atau tamu untuk link tidak valid.' USING ERRCODE='22023';
  END IF;

  SELECT g.id,g.outlet_id,o.code,o.name,g.queue_number,g.guest_name,g.packs
    INTO v_guest_id,v_outlet_id,v_outlet_code,v_outlet_name,v_queue_number,v_guest_name,v_packs
  FROM public.guest_arrivals g
  JOIN public.outlets o ON o.id=g.outlet_id AND o.active
  WHERE g.id=p_guest_arrival_id;

  IF v_guest_id IS NULL THEN
    RAISE EXCEPTION 'Tamu tidak ditemukan atau outlet tidak aktif.' USING ERRCODE='42501';
  END IF;

  v_is_dev := COALESCE(public.app_role()='dev',false);
  IF NOT v_is_dev AND NOT EXISTS (
    SELECT 1 FROM public.user_scopes s
    WHERE s.user_id=auth.uid() AND s.outlet_id=v_outlet_id
  ) THEN
    RAISE EXCEPTION 'Tamu berada di luar akses outlet akun.' USING ERRCODE='42501';
  END IF;

  IF p_action='revoke' THEN
    UPDATE public.guest_arrival_public_links
    SET active=false,revoked_at=clock_timestamp()
    WHERE guest_arrival_id=v_guest_id AND active AND revoked_at IS NULL;
    GET DIAGNOSTICS v_revoked_count = ROW_COUNT;
    RETURN jsonb_build_object(
      'ok',true,'revoked',v_revoked_count>0,'guest_arrival_id',v_guest_id,
      'queue_code','WL-'||lpad(v_queue_number::text,3,'0')
    );
  END IF;

  -- Replacing a per-guest link invalidates the old token immediately.
  UPDATE public.guest_arrival_public_links
  SET active=false,revoked_at=clock_timestamp()
  WHERE guest_arrival_id=v_guest_id AND active AND revoked_at IS NULL;

  v_token := encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.guest_arrival_public_links(guest_arrival_id,token_hash,created_by)
  VALUES(v_guest_id,encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid())
  RETURNING id INTO v_link_id;

  RETURN jsonb_build_object(
    'ok',true,'token',v_token,'link_id',v_link_id,
    'guest_arrival_id',v_guest_id,'queue_number',v_queue_number,
    'queue_code','WL-'||lpad(v_queue_number::text,3,'0'),
    'guest_name',v_guest_name,'packs',v_packs,
    'outlet_code',v_outlet_code,'outlet_name',v_outlet_name
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_arrival_public_ticket(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','auth','extensions'
AS $function$
DECLARE
  v_link public.guest_arrival_public_links;
  v_now timestamptz;
  v_count integer;
  v_ticket jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'Akses endpoint publik tidak valid.' USING ERRCODE='42501';
  END IF;
  IF p_token IS NULL OR p_token !~ '^[a-fA-F0-9]{64}$' THEN
    RAISE EXCEPTION 'Link antrean tidak valid atau sudah dinonaktifkan.' USING ERRCODE='P0002';
  END IF;

  SELECT l.* INTO v_link
  FROM public.guest_arrival_public_links l
  WHERE l.token_hash=encode(extensions.digest(lower(p_token),'sha256'),'hex')
    AND l.active AND l.revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link antrean tidak valid atau sudah dinonaktifkan.' USING ERRCODE='P0002';
  END IF;

  v_now := clock_timestamp();
  INSERT INTO public.guest_arrival_public_rate_limits(link_id,window_start,request_count)
  VALUES(v_link.id,date_trunc('minute',v_now),1)
  ON CONFLICT(link_id,window_start)
  DO UPDATE SET request_count=public.guest_arrival_public_rate_limits.request_count+1
  RETURNING request_count INTO v_count;
  IF v_count>60 THEN
    RAISE EXCEPTION 'Terlalu banyak permintaan. Coba lagi dalam satu menit.' USING ERRCODE='P0001';
  END IF;
  IF v_count=1 THEN
    DELETE FROM public.guest_arrival_public_rate_limits
    WHERE window_start < date_trunc('minute',v_now)-interval '2 days';
  END IF;

  SELECT jsonb_build_object(
    'queue_number',g.queue_number,
    'queue_code','WL-'||lpad(g.queue_number::text,3,'0'),
    'status',g.status,
    'packs',g.packs,
    'operational_date',g.operational_date,
    'arrived_at',g.arrived_at,
    'outlet_code',o.code,
    'outlet_name',o.name
  )
  INTO v_ticket
  FROM public.guest_arrivals g
  JOIN public.outlets o ON o.id=g.outlet_id AND o.active
  WHERE g.id=v_link.guest_arrival_id;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'Link antrean tidak valid atau sudah dinonaktifkan.' USING ERRCODE='P0002';
  END IF;
  -- Deliberate allow-list: no guest name, phone, notes, or internal row identifiers.
  RETURN v_ticket;
END;
$function$;

REVOKE ALL ON FUNCTION public.guest_arrival_guest_link_manage(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_guest_link_manage(text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.guest_arrival_public_ticket(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_arrival_public_ticket(text) TO service_role;

COMMENT ON TABLE public.guest_arrival_public_links IS
  'Hash-only, revocable per-guest view links. Plain token is returned once to an authorized admin.';
COMMENT ON TABLE public.guest_arrival_public_rate_limits IS
  'Per-link minute buckets limiting guest ticket status refreshes.';
