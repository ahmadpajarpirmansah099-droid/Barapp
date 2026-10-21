const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const sql = fs.readFileSync('barapp_security_remove_employee_login_pin.sql', 'utf8');

assert(!/staff_login|staff_me|staff_attendance|staff_logout|staff_set_pin/.test(html),
  'Browser code must not expose employee PIN login/session RPC calls');
assert(!/function\s+(?:staffPinAsk|staffPinGo|lgK|pinOpen|pinSave)\b/.test(html),
  'Employee login/PIN handlers must be removed');
assert(!/onclick=["'][^"']*(?:pinOpen|lgK)\(/.test(html),
  'Employee login/PIN controls must not remain in the UI');
assert(!/Masuk sebagai Karyawan|Sign in as Employee|Atur PIN login|PIN login —/.test(html),
  'Employee login/PIN copy must not remain in the UI');
assert.match(html, /sessionStorage\.removeItem\('barapp_staff_session_v1'\)/,
  'Any legacy employee session token must be cleared on load');
assert(!/sessionStorage\.setItem\(['"]barapp_staff_session_v1/.test(html),
  'Browser code must not persist new employee sessions');

const svStart = html.indexOf('const sv=()=>{try{const {emp,att,...rest}=D;');
const svEnd = html.indexOf('const $=', svStart);
assert.ok(svStart >= 0 && svEnd > svStart, 'Could not locate Barapp sv() persistence function');
const svSource = html.slice(svStart, html.lastIndexOf(';', svEnd) + 1);
const makeStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed).map(([k, v]) => [k, String(v)]));
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    map
  };
};
const K = 'absensi_bar_v1';
const localStorage = makeStorage();
const LEG = { emp: [], att: [] };
const D = { me: { r: 'A', uid: 'admin-1', email: 'admin@example.invalid' }, emp: [], att: [], cur: 'x' };
const toast = () => {};
const sv = new Function('D', 'LEG', 'K', 'localStorage', 'toast', `${svSource}; return sv;`)(D, LEG, K, localStorage, toast);
sv();
assert.equal(JSON.parse(localStorage.getItem(K)).me, undefined,
  'Admin identity must be rehydrated by Supabase Auth, not app localStorage');

const staffFunctions = [
  ['staff_login', 'text, text'],
  ['staff_me', 'text'],
  ['staff_attendance', 'text'],
  ['staff_logout', 'text'],
  ['staff_set_pin', 'text, text']
];
for (const [name, args] of staffFunctions) {
  assert.match(sql, new RegExp('REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.' + name + '\\(' + args.replace(/, /g, ',\\s*') + '\\)\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated', 'i'),
    'Migration must disable browser execution of ' + name);
}
assert.match(sql, /BEGIN\s*;/i, 'Migration must be transactional');
assert.match(sql, /COMMIT\s*;/i, 'Migration must be transactional');
assert.match(sql, /REVOKE\s+SELECT\s*,\s*INSERT\s*,\s*UPDATE\s+ON\s+TABLE\s+public\.employees\s+FROM\s+authenticated/i,
  'Broad employee read/write privileges must be revoked');
assert.match(sql, /GRANT SELECT \(id, name, role, active, created_at, outlet_id, division_id, deleted_at\)/i,
  'Admin employee read allowlist must remain');
assert.match(sql, /GRANT INSERT \(name, role, active, outlet_id, division_id\)/i,
  'Admin employee create allowlist must remain');
assert.match(sql, /GRANT UPDATE \(name, role, active, deleted_at\)/i,
  'Admin employee update allowlist must remain');
assert.match(sql, /PIN verifier metadata server-only/i,
  'Migration must document that PIN metadata stays server-only');

console.log('Employee login/PIN removal regression checks passed.');
