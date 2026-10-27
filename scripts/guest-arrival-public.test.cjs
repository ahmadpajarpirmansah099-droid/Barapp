const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261027190000_guest_arrival_public_queue.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/guest-arrival-public/index.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'guest-queue.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'guest-arrival.js'), 'utf8');

test('public RPCs are not executable by anon or authenticated users', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.guest_arrival_public_outlet\(text\) FROM PUBLIC,\s*anon,\s*authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.guest_arrival_public_outlet\(text\) TO service_role/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.guest_arrival_public_create\(text,text,integer,text,text,text,uuid\) FROM PUBLIC,\s*anon,\s*authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.guest_arrival_public_create\(text,text,integer,text,text,text,uuid\) TO service_role/i);
});

test('public link table stores only a hash and denies direct public grants', () => {
  assert.match(sql, /token_hash text NOT NULL UNIQUE/i);
  assert.match(sql, /extensions\.digest\(v_token,'sha256'\)/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.guest_arrival_public_links FROM PUBLIC,\s*anon,\s*authenticated/i);
  assert.match(sql, /ALTER TABLE public\.guest_arrival_public_links ENABLE ROW LEVEL SECURITY/i);
});

test('public registration reuses central counter and prevents duplicate/rate abuse', () => {
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_request_id::text,0\)\)/i);
  assert.match(sql, /ON CONFLICT\(outlet_id,operational_date\) DO NOTHING/i);
  assert.match(sql, /last_number=last_number\+1/i);
  assert.match(sql, /IF v_count>30 THEN/i);
  assert.match(sql, /registration_source\s*\)\s*VALUES[\s\S]*?'public'/i);
});

test('edge endpoint returns a safe allow-list and does not log the token', () => {
  assert.match(edge, /guest_arrival_public_outlet/);
  assert.match(edge, /guest_arrival_public_create/);
  assert.match(edge, /queue_number:\s*ticket\.queue_number/);
  assert.doesNotMatch(edge, /console\.log\([^)]*token/i);
  assert.match(edge, /Permintaan belum berhasil diproses\. Coba lagi\./i);
});

test('public ticket token is carried in the URL fragment, not sent with page request', () => {
  assert.match(page, /location\.hash/);
  assert.match(page, /meta name="referrer" content="no-referrer"/i);
  assert.match(page, /referrerPolicy:\s*"no-referrer"/i);
  assert.match(page, /history\.replaceState/);
});

test('admin UI generates QR links and marks public registrations', () => {
  assert.match(admin, /guestArrivalOpenPublicLink/);
  assert.match(admin, /registration_source === 'public'/);
  assert.match(admin, /guest_arrival_public_link_manage/);
});


test('admin list and export payloads include registration source', () => {
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.guest_arrival_row_json'));
  assert.ok(sql.includes("'registration_source', p_row.registration_source"));
  assert.ok(admin.includes("['Sumber','registration_source']"));
});


test('link lifecycle requires an authorized user and an active scoped outlet', () => {
  assert.ok(sql.includes("auth.uid() IS NULL OR COALESCE(auth.role(),'') <> 'authenticated'"));
  assert.ok(sql.includes("IF NOT public.guest_arrival_can_access()"));
  assert.ok(sql.includes("v_is_dev := public.app_role()='dev'"));
  assert.ok(sql.includes("FROM public.user_scopes s"));
  assert.ok(sql.includes("JOIN public.outlets o ON o.id=s.outlet_id AND o.active"));
  assert.ok(sql.includes("Outlet tidak ditemukan, tidak aktif, atau di luar akses akun"));
  assert.ok(sql.includes("REVOKE ALL ON TABLE public.guest_arrival_public_rate_limits FROM PUBLIC, anon, authenticated"));
});


test('public RPCs enforce service-role checks and reject invalid or revoked tokens', () => {
  assert.ok((sql.match(/COALESCE\(auth\.role\(\),''\) <> 'service_role'/g) || []).length >= 2);
  assert.ok((sql.match(/p_token IS NULL OR p_token !~ '\^\[a-fA-F0-9\]\{64\}\$'/g) || []).length >= 2);
  assert.match(sql, /AND l\.active AND l\.revoked_at IS NULL/i);
});

test('only one active public link can exist per outlet and revocation is explicit', () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS guest_arrival_public_links_one_active_per_outlet[\s\S]*?WHERE active AND revoked_at IS NULL/i);
  assert.match(sql, /SET active=false,revoked_at=clock_timestamp\(\)/i);
  assert.match(sql, /UPDATE public\.guest_arrival_public_links[\s\S]*?WHERE outlet_id=v_outlet_id AND active AND revoked_at IS NULL/i);
});

test('public queue insertion respects the existing waiting-state schema', () => {
  const insertMatch = sql.match(/INSERT INTO public\.guest_arrivals\(([\s\S]*?)\)\s*VALUES\(([\s\S]*?)\)\s*RETURNING \* INTO v_row/i);
  assert.ok(insertMatch, 'public registration must insert a guest_arrivals row');
  assert.match(insertMatch[1], /outlet_id[\s\S]*operational_date[\s\S]*queue_number[\s\S]*request_id[\s\S]*registration_source/i);
  assert.match(insertMatch[2], /'Menunggu'[\s\S]*NULL[\s\S]*NULL[\s\S]*NULL[\s\S]*'public-web'[\s\S]*'public'/i);
  assert.match(sql, /UPDATE public\.guest_arrival_daily_counters[\s\S]*?SET last_number=last_number\+1/i);
});

test('public ticket response is an allow-list that excludes guest PII and internal row IDs', () => {
  const responseMatch = sql.match(/-- Allow-list only:[\s\S]*?RETURN jsonb_build_object\(([\s\S]*?)\);/i);
  assert.ok(responseMatch, 'ticket response allow-list must be present');
  const response = responseMatch[1];
  assert.match(response, /queue_number/);
  assert.match(response, /queue_code/);
  assert.match(response, /outlet_code/);
  assert.doesNotMatch(response, /guest_name|whatsapp|packs|note|v_row\.id|created_by/i);
});

test('public form removes the token fragment after success and does not put token in query parameters', () => {
  assert.match(page, /location\.hash/);
  assert.match(page, /history\.replaceState\(null,\s*"",\s*location\.pathname\s*\+\s*location\.search\)/);
  assert.match(page, /referrerPolicy:\s*"no-referrer"/i);
  assert.match(page, /meta name="referrer" content="no-referrer"/i);
  assert.match(admin, /url\.hash\s*=\s*'token='/i);
});
