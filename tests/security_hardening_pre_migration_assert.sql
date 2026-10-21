-- Baseline control: before hardening, an unlisted temp schema shadows the public relation.
CREATE TEMP TABLE path_probe(value text NOT NULL);
INSERT INTO path_probe(value) VALUES ('attacker-temp-object');

DO $baseline$
BEGIN
  IF public.path_probe_value() <> 'attacker-temp-object' THEN
    RAISE EXCEPTION 'TEST_FAILURE: baseline did not reproduce pg_temp shadowing; test fixture is ineffective';
  END IF;
  RAISE NOTICE 'PASS: baseline reproduces temporary relation shadowing before hardening.';
END;
$baseline$;
