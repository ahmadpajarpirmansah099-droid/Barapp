const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261027190000_guest_arrival_public_queue.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/guest-arrival-public/index.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'guest-queue.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'guest-arrival.js'), 'utf8');

test('guest links are tied to one existing guest row and store only token hashes', () => {
  assert.match(sql, /guest_arrival_id uuid NOT NULL REFERENCES public\.guest_arrivals\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /token_hash text NOT NULL UNIQUE/i);
  assert.match(sql, /extensions\.digest\(v_token,'sha256'\)/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.guest_arrival_public_links FROM PUBLIC,anon,authenticated/i);
  assert.match(sql, /ALTER TABLE public\.guest_arrival_public_links ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /guest_arrival_public_links_one_active_per_guest[\s\S]*?ON public\.guest_arrival_public_links\(guest_arrival_id\)/i);
  assert.doesNotMatch(sql, /outlet_id uuid NOT NULL REFERENCES public\.outlets/i);
});

test('admins can create/revoke per-guest links only within their outlet scope', () => {
  assert.match(sql, /guest_arrival_guest_link_manage\([\s\S]*?p_action text, p_guest_arrival_id uuid/i);
  assert.match(sql, /auth\.uid\(\) IS NULL OR COALESCE\(auth\.role\(\),' '\) <> 'authenticated'/i);
  assert.match(sql, /IF NOT v_is_dev AND NOT EXISTS \([\s\S]*?s\.user_id=auth\.uid\(\) AND s\.outlet_id=v_outlet_id/i);
  assert.match(sql, /p_action='revoke'[\s\S]*?guest_arrival_id=v_guest_id/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.guest_arrival_guest_link_manage\(text,uuid\) FROM PUBLIC,anon,authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.guest_arrival_guest_link_manage\(text,uuid\) TO authenticated/i);
});

test('public endpoint only reads a linked ticket and cannot register new guests', () => {
  assert.match(sql, /guest_arrival_public_ticket\(p_token text\)/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.guest_arrival_public_ticket\(text\) FROM PUBLIC,anon,authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.guest_arrival_public_ticket\(text\) TO service_role/i);
  assert.match(edge, /guest_arrival_public_ticket/);
  assert.match(edge, /String\(body\.action \?\? ""\) !== "ticket"/);
  assert.doesNotMatch(edge, /guest_arrival_public_create|body\.name|body\.packs/);
  assert.doesNotMatch(sql, /guest_arrival_public_create|INSERT INTO public\.guest_arrivals/i);
});

test('public ticket response is an allow-list without guest PII or internal identifiers', () => {
  const responseMatch = sql.match(/-- Deliberate allow-list:[\s\S]*?RETURN v_ticket;/i);
  assert.ok(responseMatch, 'public ticket allow-list must be present');
  assert.match(responseMatch[0], /queue_number/);
  assert.match(responseMatch[0], /queue_code/);
  assert.match(responseMatch[0], /status/);
  assert.match(responseMatch[0], /outlet_name/);
  assert.doesNotMatch(responseMatch[0], /guest_name|whatsapp|note|created_by|guest_arrival_id|'id'/i);
  assert.match(sql, /IF v_count>60 THEN/i);
});

test('admin saves the queue before generating a guest-specific share link', () => {
  const saveStart = admin.indexOf('async function guestArrivalSaveForm()');
  const saveEnd = admin.indexOf('\nfunction guestArrivalOpenPendingModal()', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const save = admin.slice(saveStart, saveEnd);
  assert.ok(save.indexOf("gaRpc('guest_arrival_create'") < save.indexOf("gaRpc('guest_arrival_guest_link_manage'"));
  assert.match(save, /p_guest_arrival_id:result\.id/);
  assert.match(save, /f\.createdResult = result/);
  assert.match(admin, /Link Tamu/);
  assert.match(admin, /Kirim via WhatsApp/);
  assert.match(admin, /url\.hash\s*=\s*'token='/i);
  assert.doesNotMatch(admin, /guestArrivalOpenPublicLink|Link \/ QR Publik/);
});

test('guest page is view-only, removes the URL fragment, and refreshes ticket status', () => {
  assert.match(page, /location\.hash/);
  assert.match(page, /history\.replaceState\(null, "", location\.pathname \+ location\.search\)/);
  assert.match(page, /referrerPolicy:\s*"no-referrer"/i);
  assert.match(page, /JSON\.stringify\(\{ action: "ticket", token \}\)/);
  assert.match(page, /window\.setInterval\(refreshTicket, 15000\)/);
  assert.doesNotMatch(page, /<form\b|id="guest-name"|Ambil Nomor Antrean|id="submit"/i);
  assert.doesNotMatch(page, /guest_name|whatsapp|note/);
});

test('public endpoints and secret token are not directly exposed through table grants or logs', () => {
  assert.match(sql, /REVOKE ALL ON TABLE public\.guest_arrival_public_rate_limits FROM PUBLIC,anon,authenticated/i);
  assert.doesNotMatch(edge, /console\.log\([^)]*token/i);
  assert.match(edge, /console\.error\("guest-arrival-public request failed", \{ code: err\.code, status: err\.status \}\)/);
});
