#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=barapp_test}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

readonly OUTLET_ID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
readonly DEV_ID="11111111-1111-4111-8111-111111111111"
readonly PARALLEL_REQUESTS=20

TOKEN="$(
  psql -X -qAt -v ON_ERROR_STOP=1 \
    -c "SELECT set_config('request.jwt.claim.sub','${DEV_ID}',false)" \
    -c "SELECT set_config('request.jwt.claim.role','authenticated',false)" \
    -c "SELECT set_config('test.app_role','dev',false)" \
    -c "SELECT public.guest_arrival_public_link_manage('create','${OUTLET_ID}') ->> 'token'" \
  | tail -n 1
)"
if [[ ! "$TOKEN" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Failed to create a disposable link token for concurrency testing." >&2
  exit 1
fi
export TOKEN

numbers_file="$(mktemp)"
trap 'rm -f "$numbers_file"' EXIT

seq 1 "$PARALLEL_REQUESTS" | xargs -P "$PARALLEL_REQUESTS" -I '{}' bash -c '
  set -euo pipefail
  guest_name="Parallel Guest $1"
  psql -X -qAt -v ON_ERROR_STOP=1 \
    -v token="$TOKEN" -v guest_name="$guest_name" \
    -c "SELECT set_config('''request.jwt.claim.role''','''service_role''',false)" \
    -c "SELECT public.guest_arrival_public_create(:'''token''', :'''guest_name''', 1, NULL, '''Non Smoking''', NULL, gen_random_uuid())->>'''queue_number'''" \
  | tail -n 1
' _ '{}' > "$numbers_file"

line_count="$(wc -l < "$numbers_file" | tr -d ' ')"
unique_count="$(sort -u "$numbers_file" | wc -l | tr -d ' ')"
if [[ "$line_count" -ne "$PARALLEL_REQUESTS" || "$unique_count" -ne "$PARALLEL_REQUESTS" ]]; then
  echo "Concurrent registration returned duplicate or missing queue numbers (rows=$line_count, unique=$unique_count)." >&2
  cat "$numbers_file" >&2
  exit 1
fi

psql -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
DO $assert$
DECLARE
  v_count integer;
  v_distinct integer;
  v_counter integer;
  v_max integer;
  v_date date := (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  SELECT count(*), count(DISTINCT queue_number)
  INTO v_count, v_distinct
  FROM public.guest_arrivals
  WHERE guest_name LIKE 'Parallel Guest %'
    AND registration_source='public'
    AND operational_date=v_date;
  ASSERT v_count=20 AND v_distinct=20,
    'concurrent public queue requests must insert 20 distinct rows';
  SELECT last_number INTO v_counter
  FROM public.guest_arrival_daily_counters
  WHERE outlet_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND operational_date=v_date;
  SELECT max(queue_number) INTO v_max
  FROM public.guest_arrivals
  WHERE outlet_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND operational_date=v_date;
  ASSERT v_counter=v_max, 'daily counter must match highest allocated queue number';
END
$assert$;
SELECT 'concurrent queue allocation passed' AS result;
SQL
