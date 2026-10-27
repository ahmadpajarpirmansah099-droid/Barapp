-- End-to-end logic tests for the migration on disposable PostgreSQL.
-- The simulated auth claim helpers exist only in the CI fixture.

DO $test$
DECLARE
  v_outlet_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_other_outlet_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_dev_id uuid := '11111111-1111-4111-8111-111111111111';
  v_manager_id uuid := '22222222-2222-4222-8222-222222222222';
  v_link jsonb;
  v_new_link jsonb;
  v_ticket jsonb;
  v_duplicate jsonb;
  v_public_outlet jsonb;
  v_revoke jsonb;
  v_token text;
  v_new_token text;
  v_request_id uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v_count integer;
  v_denied boolean;
  v_i integer;
BEGIN
  -- Schema-level grants must keep public tables and RPCs away from anon/authenticated.
  ASSERT NOT has_table_privilege('anon','public.guest_arrival_public_links','SELECT');
  ASSERT NOT has_table_privilege('authenticated','public.guest_arrival_public_links','SELECT');
  ASSERT NOT has_table_privilege('anon','public.guest_arrival_public_rate_limits','SELECT');
  ASSERT NOT has_function_privilege('anon','public.guest_arrival_public_outlet(text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.guest_arrival_public_outlet(text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.guest_arrival_public_create(text,text,integer,text,text,text,uuid)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.guest_arrival_public_outlet(text)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.guest_arrival_public_create(text,text,integer,text,text,text,uuid)','EXECUTE');

  -- A non-dev user with one outlet scope cannot create a link for a different outlet.
  PERFORM set_config('request.jwt.claim.sub',v_manager_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('test.app_role','manager',true);
  v_denied := false;
  BEGIN
    PERFORM public.guest_arrival_public_link_manage('create',v_other_outlet_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := true;
  END;
  ASSERT v_denied, 'out-of-scope manager was able to create a public link';

  -- Authorized developer creates a one-time token; only its hash is stored.
  PERFORM set_config('request.jwt.claim.sub',v_dev_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('test.app_role','dev',true);
  v_link := public.guest_arrival_public_link_manage('create',v_outlet_id);
  v_token := v_link->>'token';
  ASSERT (v_link->>'ok')::boolean IS TRUE;
  ASSERT length(v_token)=64 AND v_token ~ '^[a-f0-9]{64}$';
  ASSERT v_link->>'outlet_code'='LJN';
  SELECT count(*) INTO v_count
  FROM public.guest_arrival_public_links
  WHERE outlet_id=v_outlet_id
    AND token_hash=encode(extensions.digest(v_token,'sha256'),'hex')
    AND token_hash <> v_token;
  ASSERT v_count=1, 'plaintext token must not be stored';

  -- Service-role-only endpoint returns outlet identity and creates a queue row.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_public_outlet := public.guest_arrival_public_outlet(v_token);
  ASSERT v_public_outlet->>'outlet_code'='LJN';
  v_ticket := public.guest_arrival_public_create(
    v_token,'Test Guest',2,'081234567890','Non Smoking','CI integration test',v_request_id
  );
  ASSERT (v_ticket->>'ok')::boolean IS TRUE;
  ASSERT (v_ticket->>'queue_number')::integer=1;
  ASSERT v_ticket->>'queue_code'='WL-001';
  ASSERT v_ticket->>'status'='Menunggu';
  ASSERT NOT (v_ticket ? 'guest_name');
  ASSERT NOT (v_ticket ? 'whatsapp');
  SELECT count(*) INTO v_count FROM public.guest_arrivals WHERE request_id=v_request_id;
  ASSERT v_count=1;
  ASSERT (SELECT registration_source FROM public.guest_arrivals WHERE request_id=v_request_id)='public';

  -- Retry with the same request ID returns the same ticket and does not duplicate rows.
  v_duplicate := public.guest_arrival_public_create(
    v_token,'Test Guest',2,'081234567890','Non Smoking','CI integration test',v_request_id
  );
  ASSERT (v_duplicate->>'duplicate_request')::boolean IS TRUE;
  ASSERT v_duplicate->>'queue_number'=v_ticket->>'queue_number';
  SELECT count(*) INTO v_count FROM public.guest_arrivals WHERE request_id=v_request_id;
  ASSERT v_count=1;

  -- Revocation invalidates the previous token immediately.
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_revoke := public.guest_arrival_public_link_manage('revoke',v_outlet_id);
  ASSERT (v_revoke->>'revoked')::boolean IS TRUE;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_denied := false;
  BEGIN
    PERFORM public.guest_arrival_public_outlet(v_token);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_denied := true;
  END;
  ASSERT v_denied, 'revoked token was still accepted';

  -- Rate limit is enforced at 30 requests per link per minute.
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_new_link := public.guest_arrival_public_link_manage('create',v_outlet_id);
  v_new_token := v_new_link->>'token';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  FOR v_i IN 1..30 LOOP
    PERFORM public.guest_arrival_public_create(
      v_new_token,'Guest '||v_i,1,NULL,'Non Smoking',NULL,
      ('00000000-0000-4000-8000-'||lpad(to_hex(v_i),12,'0'))::uuid
    );
  END LOOP;
  v_denied := false;
  BEGIN
    PERFORM public.guest_arrival_public_create(
      v_new_token,'Rate Limit Guest',1,NULL,'Non Smoking',NULL,
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_denied := true;
  END;
  ASSERT v_denied, '31st registration request should be rate limited';

  -- Every queue number for this outlet/day remains unique and synchronized to its counter.
  SELECT count(*) INTO v_count
  FROM (
    SELECT queue_number
    FROM public.guest_arrivals
    WHERE outlet_id=v_outlet_id
      AND operational_date=(clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date
    GROUP BY queue_number
    HAVING count(*)>1
  ) duplicates;
  ASSERT v_count=0;
  ASSERT (SELECT last_number FROM public.guest_arrival_daily_counters
          WHERE outlet_id=v_outlet_id
            AND operational_date=(clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date)
         = (SELECT max(queue_number) FROM public.guest_arrivals
            WHERE outlet_id=v_outlet_id
              AND operational_date=(clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date);
END
$test$;

SELECT 'guest-arrival-public integration tests passed' AS result;
