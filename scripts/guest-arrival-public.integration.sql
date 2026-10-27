-- Integration tests on disposable PostgreSQL: admin-created rows, per-guest links, read-only ticket views.
DO $test$
DECLARE
  v_outlet_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_other_outlet_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_dev_id uuid := '11111111-1111-4111-8111-111111111111';
  v_manager_id uuid := '22222222-2222-4222-8222-222222222222';
  v_date date := (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  v_guest_id uuid;
  v_other_guest_id uuid;
  v_link jsonb;
  v_new_link jsonb;
  v_ticket jsonb;
  v_revoked jsonb;
  v_token text;
  v_new_token text;
  v_count integer;
  v_denied boolean;
  v_i integer;
BEGIN
  ASSERT NOT has_table_privilege('anon','public.guest_arrival_public_links','SELECT');
  ASSERT NOT has_table_privilege('authenticated','public.guest_arrival_public_links','SELECT');
  ASSERT NOT has_table_privilege('anon','public.guest_arrival_public_rate_limits','SELECT');
  ASSERT NOT has_function_privilege('anon','public.guest_arrival_guest_link_manage(text,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.guest_arrival_public_ticket(text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.guest_arrival_public_ticket(text)','EXECUTE');
  ASSERT has_function_privilege('authenticated','public.guest_arrival_guest_link_manage(text,uuid)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.guest_arrival_public_ticket(text)','EXECUTE');

  -- Create fixture guest rows as if an authorized admin had saved them in Barapp.
  INSERT INTO public.guest_arrival_daily_counters(outlet_id,operational_date,last_number)
  VALUES(v_outlet_id,v_date,1),(v_other_outlet_id,v_date,1)
  ON CONFLICT(outlet_id,operational_date) DO NOTHING;
  INSERT INTO public.guest_arrivals(
    outlet_id,operational_date,queue_number,guest_name,packs,whatsapp,
    smoking_preference,note,arrived_at,status,request_id,created_by,created_by_email
  ) VALUES (
    v_outlet_id,v_date,1,'Admin Created Guest',2,'081234567890',
    'Non Smoking','private note',clock_timestamp(),'Menunggu',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',v_dev_id,'dev@example.test'
  ) RETURNING id INTO v_guest_id;
  INSERT INTO public.guest_arrivals(
    outlet_id,operational_date,queue_number,guest_name,packs,arrived_at,status,
    request_id,created_by,created_by_email
  ) VALUES (
    v_other_outlet_id,v_date,1,'Out of Scope Guest',1,clock_timestamp(),'Menunggu',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',v_manager_id,'manager@example.test'
  ) RETURNING id INTO v_other_guest_id;

  -- Manager is scoped to LJN only and must not generate a link for the other outlet.
  PERFORM set_config('request.jwt.claim.sub',v_manager_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('test.app_role','manager',true);
  v_denied := false;
  BEGIN
    PERFORM public.guest_arrival_guest_link_manage('create',v_other_guest_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  ASSERT v_denied, 'out-of-scope manager generated a guest link';

  -- Developer creates a token for this one already-existing guest; only its hash is stored.
  PERFORM set_config('request.jwt.claim.sub',v_dev_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('test.app_role','dev',true);
  v_link := public.guest_arrival_guest_link_manage('create',v_guest_id);
  v_token := v_link->>'token';
  ASSERT (v_link->>'ok')::boolean IS TRUE;
  ASSERT length(v_token)=64 AND v_token ~ '^[a-f0-9]{64}$';
  ASSERT v_link->>'queue_code'='WL-001';
  SELECT count(*) INTO v_count FROM public.guest_arrival_public_links
   WHERE guest_arrival_id=v_guest_id
     AND token_hash=encode(extensions.digest(v_token,'sha256'),'hex')
     AND token_hash<>v_token;
  ASSERT v_count=1, 'plaintext token must not be stored';

  -- Service-role ticket endpoint returns only the allow-listed fields; it cannot create guests.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_ticket := public.guest_arrival_public_ticket(v_token);
  ASSERT v_ticket->>'queue_code'='WL-001';
  ASSERT v_ticket->>'status'='Menunggu';
  ASSERT (v_ticket->>'packs')::integer=2;
  ASSERT v_ticket->>'outlet_name'='Lazy Jennie';
  ASSERT NOT (v_ticket ? 'guest_name');
  ASSERT NOT (v_ticket ? 'whatsapp');
  ASSERT NOT (v_ticket ? 'note');
  ASSERT NOT (v_ticket ? 'id');
  SELECT count(*) INTO v_count FROM public.guest_arrivals WHERE id=v_guest_id;
  ASSERT v_count=1, 'opening ticket must not create another queue row';

  -- Replacing a link returns a new token and invalidates the old token.
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_new_link := public.guest_arrival_guest_link_manage('create',v_guest_id);
  v_new_token := v_new_link->>'token';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_denied := false;
  BEGIN
    PERFORM public.guest_arrival_public_ticket(v_token);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_denied := true;
  END;
  ASSERT v_denied, 'replaced token was still accepted';

  -- A new link is limited to 60 reads per minute; the 61st lookup is rejected.
  FOR v_i IN 1..60 LOOP
    PERFORM public.guest_arrival_public_ticket(v_new_token);
  END LOOP;
  v_denied := false;
  BEGIN
    PERFORM public.guest_arrival_public_ticket(v_new_token);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_denied := true;
  END;
  ASSERT v_denied, '61st ticket read should be rate limited';

  -- Moving a guest from Menunggu to Duduk automatically revokes the active ticket link.
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_link := public.guest_arrival_guest_link_manage('create',v_guest_id);
  v_token := v_link->>'token';
  UPDATE public.guest_arrivals
  SET status='Duduk', seated_at=clock_timestamp(), table_name='Meja 01',
      waiting_seconds=GREATEST(0, floor(extract(epoch FROM (clock_timestamp()-arrived_at)))::integer)
  WHERE id=v_guest_id AND status='Menunggu';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_denied := false;
  BEGIN
    PERFORM public.guest_arrival_public_ticket(v_token);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_denied := true;
  END;
  ASSERT v_denied, 'ticket link should be automatically revoked when guest becomes seated';
  SELECT count(*) INTO v_count FROM public.guest_arrival_public_links
   WHERE guest_arrival_id=v_guest_id AND active AND revoked_at IS NULL;
  ASSERT v_count=0, 'no active guest link should remain after seating';
  SELECT count(*) INTO v_count FROM public.guest_arrivals WHERE id=v_guest_id AND status='Duduk';
  ASSERT v_count=1, 'seating should preserve the guest queue record';

  SELECT count(*) INTO v_count FROM public.guest_arrivals WHERE id=v_guest_id;
  ASSERT v_count=1, 'ticket views must never insert queue rows';
END
$test$;

SELECT 'per-guest ticket integration tests passed' AS result;
