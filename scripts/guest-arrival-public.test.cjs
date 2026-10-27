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
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\\.guest_arrival_row_json[\\s\\S]*?'registration_source',\\s*p_row\\.registration_source/i);
  assert.match(admin, /\\['Sumber','registration_source'\\]/);
});
