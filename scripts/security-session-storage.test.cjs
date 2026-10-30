const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const state = fs.readFileSync('public/core/state.js', 'utf8');
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
const STAFF_SESSION_KEY = 'barapp_staff_session_v1';
const localStorage = makeStorage();
const sessionStorage = makeStorage();
const LEG = { emp: [], att: [] };
const D = { me: { r: 'K', id: 'emp-1', tok: 'TEST_STAFF_TOKEN' }, emp: [], att: [], cur: 'x' };
const toast = () => {};
const sv = new Function('D', 'LEG', 'K', 'STAFF_SESSION_KEY', 'localStorage', 'sessionStorage', 'toast', `${svSource}; return sv;`)(D, LEG, K, STAFF_SESSION_KEY, localStorage, sessionStorage, toast);

sv();
assert.equal(JSON.parse(localStorage.getItem(K)).me, undefined, 'D.me must not be persisted in app localStorage');
assert.equal(localStorage.getItem(K).includes('TEST_STAFF_TOKEN'), false, 'staff token must not appear in app localStorage');
assert.equal(JSON.parse(sessionStorage.getItem(STAFF_SESSION_KEY)).tok, 'TEST_STAFF_TOKEN', 'staff token should live in sessionStorage');

D.me = { r: 'A', uid: 'admin-1', email: 'admin@example.invalid' };
sv();
assert.equal(sessionStorage.getItem(STAFF_SESSION_KEY), null, 'admin session must clear custom staff token');
assert.equal(JSON.parse(localStorage.getItem(K)).me, undefined, 'admin identity must be rehydrated by Supabase Auth, not app localStorage');

D.me = null;
sv();
assert.equal(sessionStorage.getItem(STAFF_SESSION_KEY), null, 'signed-out state must clear staff token');

const migrationStart = state.indexOf("try{const persisted=JSON.parse(localStorage.getItem(K)||'{}');");
const migrationEnd = state.indexOf('\n/* ===== DATA LOKAL LAMA', migrationStart);
assert.ok(migrationStart >= 0 && migrationEnd > migrationStart, 'Could not locate legacy-token cleanup block');
const migrationSource = state.slice(migrationStart, migrationEnd);
const runMigration = new Function('D', 'K', 'STAFF_SESSION_KEY', 'localStorage', 'sessionStorage', migrationSource);

const oldLocal = makeStorage({ [K]: JSON.stringify({ me: { r: 'K', id: 'emp-old', tok: 'LEGACY_TOKEN' }, emp: [] }) });
const oldSession = makeStorage();
const oldD = { me: { r: 'K', id: 'emp-old', tok: 'LEGACY_TOKEN' } };
runMigration(oldD, K, STAFF_SESSION_KEY, oldLocal, oldSession);
assert.equal(JSON.parse(oldLocal.getItem(K)).me, undefined, 'legacy persistent staff token should be removed');
assert.equal(oldD.me, null, 'legacy staff session without sessionStorage should require re-login');

const restoredSession = makeStorage({ [STAFF_SESSION_KEY]: JSON.stringify({ r: 'K', id: 'emp-1', tok: 'TAB_TOKEN' }) });
const restoredD = { me: null };
runMigration(restoredD, K, STAFF_SESSION_KEY, makeStorage({ [K]: JSON.stringify({ emp: [] }) }), restoredSession);
assert.equal(restoredD.me.tok, 'TAB_TOKEN', 'current-tab staff session should restore from sessionStorage');

console.log('Staff session storage security checks passed.');
