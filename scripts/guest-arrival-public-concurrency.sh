#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=barapp_test}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

if [[ "${1:-}" == "worker" ]]; then
  : "${TOKEN:?ticket token must be passed by the parent process}"
  psql -X -qAt -v ON_ERROR_STOP=1 -v token="$TOKEN" <<'SQL'
SELECT set_config('request.jwt.claim.role','service_role',false) \gset
SELECT public.guest_arrival_public_ticket(:'token')->>'queue_number';
SQL
  exit 0
fi

readonly OUTLET_ID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
readonly DEV_ID="11111111-1111-4111-8111-111111111111"
readonly PARALLEL_REQUESTS=20

LINK_INFO="$(
  psql -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false) \gset
SELECT set_config('request.jwt.claim.role','authenticated',false) \gset
SELECT set_config('test.app_role','dev',false) \gset
SELECT (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date AS operational_date \gset
INSERT INTO public.guest_arrival_daily_counters(outlet_id,operational_date,last_number)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', :'operational_date', 0)
ON CONFLICT(outlet_id,operational_date) DO NOTHING;
UPDATE public.guest_arrival_daily_counters
SET last_number=last_number+1,updated_at=clock_timestamp()
WHERE outlet_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND operational_date=:'operational_date'
RETURNING last_number \gset
INSERT INTO public.guest_arrivals(
  outlet_id,operational_date,queue_number,guest_name,packs,arrived_at,status,
  request_id,created_by,created_by_email
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', :'operational_date', :last_number,
  'Concurrent Link Viewer', 1, clock_timestamp(), 'Menunggu',
  gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'dev@example.test'
) RETURNING id AS guest_id \gset
SELECT public.guest_arrival_guest_link_manage('create', :'guest_id') AS link_data \gset
SELECT (:'link_data'::jsonb->>'token') || '|' || (:'link_data'::jsonb->>'queue_number');
SQL
)"
TOKEN="${LINK_INFO%%|*}"
EXPECTED_NUMBER="${LINK_INFO##*|}"
if [[ ! "$TOKEN" =~ ^[a-f0-9]{64}$ || ! "$EXPECTED_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "Failed to create a disposable existing ticket and read token." >&2
  exit 1
fi
export TOKEN EXPECTED_NUMBER

numbers_file="$(mktemp)"
trap 'rm -f "$numbers_file"' EXIT
seq 1 "$PARALLEL_REQUESTS" | xargs -P "$PARALLEL_REQUESTS" -I '{}' bash "$0" worker '{}' > "$numbers_file"

line_count="$(wc -l < "$numbers_file" | tr -d ' ')"
unique_count="$(sort -u "$numbers_file" | wc -l | tr -d ' ')"
wrong_count="$(grep -vc "^$EXPECTED_NUMBER$" "$numbers_file" || true)"
if [[ "$line_count" -ne "$PARALLEL_REQUESTS" || "$unique_count" -ne 1 || "$wrong_count" -ne 0 ]]; then
  echo "Concurrent ticket reads did not return the same existing queue number (rows=$line_count, unique=$unique_count, wrong=$wrong_count)." >&2
  cat "$numbers_file" >&2
  exit 1
fi

psql -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
DO $assert$
DECLARE
  v_count integer;
  v_counter integer;
  v_max integer;
  v_date date := (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.guest_arrivals
  WHERE guest_name='Concurrent Link Viewer' AND operational_date=v_date;
  ASSERT v_count=1, 'opening a ticket link must not create extra queue rows';
  SELECT last_number INTO v_counter FROM public.guest_arrival_daily_counters
  WHERE outlet_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND operational_date=v_date;
  SELECT max(queue_number) INTO v_max FROM public.guest_arrivals
  WHERE outlet_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND operational_date=v_date;
  ASSERT v_counter=v_max, 'daily counter must match highest allocated queue number';
END
$assert$;
SELECT 'concurrent view-only ticket checks passed' AS result;
SQL
