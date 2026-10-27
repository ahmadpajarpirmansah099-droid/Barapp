'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function section(start, end) {
  const a = html.indexOf(start);
  assert.notEqual(a, -1, 'Missing source marker: ' + start);
  const b = html.indexOf(end, a + start.length);
  assert.notEqual(b, -1, 'Missing end marker: ' + end);
  return html.slice(a, b);
}

const outInit = section('async function outInit(){', 'async function outSwitch');
assert.match(outInit, /const multi=isDeveloper\(\);/, 'Only Developer may switch the active outlet');
assert.match(outInit, /scopeOutlets\.length===1\?scopeOutlets\[0\]:null/, 'Non-developer accounts must have exactly one assigned outlet');
assert.match(outInit, /T\.scopeError=T\.scopeOutAmbiguous\?/, 'Ambiguous or missing outlet scopes must fail closed');
assert.doesNotMatch(outInit, /return validUuid\(D\.ljId\)\?D\.ljId:null/, 'Missing scopes must not fall back to Lazy Jennie');
assert.match(outInit, /const fallback=isLazyJennieHr\(\)\?null:T\.outlets\[0\]/, 'The Lazy Jennie HR account must not fall back to a different outlet');

const outSwitch = section('async function outSwitch(id){', 'async function sbLoad(silent)');
assert.match(outSwitch, /if\(!isDeveloper\(\)\|\|!id/, 'Non-developer outlet switching must be rejected');
assert.match(outSwitch, /function outMenuHtml\(\)\{\s*if\(!isDeveloper\(\)\)return '';/, 'Outlet selector must only render for Developer');


const outLabel = section('function outLabel(){', '/* ===== EDIT OUTLET (developer) ===== */');
assert.match(outLabel, /const multi=isDeveloper\(\);/, 'Outlet label must use the scoped outlet for non-developers');
assert.match(outLabel, /const id=multi\?\(D\.outId\|\|D\.ljId\):\(T\.scopeOut\|\|null\)/, 'Missing scope must not display a default outlet');

const schedule = section('async function jadDivList(){', '/* ===== JADWAL: tampilan & unduh PDF ===== */');
assert.match(schedule, /else if\(T\.dbRole==='hr'\)\{\s*const oid=await outInit\(\);/, 'HR schedule divisions must resolve from the assigned outlet');
assert.match(schedule, /q\.eq\('outlet_id',oid\)\.order\('name'\)/, 'HR schedule query must be constrained to one outlet');
assert.match(schedule, /const multiDivision=isDeveloper\(\)\|\|T\.dbRole==='hr';/, 'HR may view all divisions inside the assigned outlet');
assert.match(schedule, /const canSwitchOutlet=isDeveloper\(\);/, 'Only Developer can change schedule outlet');
assert.match(schedule, /function jadPickOut\(v\)\{if\(!isDeveloper\(\)\)return;/, 'Direct schedule outlet-switch calls must be guarded');

const employee = section('function empOutDivHtml(defOut){', 'async function openEmp(i)');
assert.match(employee, /const visibleOuts=isDeveloper\(\)\?outs:outs\.filter\(o=>String\(o\.id\)===String\(cur\)\)/, 'HR employee form must not offer other outlets');
assert.match(employee, /function empDivRefresh\(\)\{const oid=isDeveloper\(\)\?v\('eo'\):\(D\.outId\|\|T\.scopeOut\)/, 'Non-developer division selection must be bound to the scoped outlet');

const saveEmployee = section('async function saveEmp(){', 'function togEmp(');
assert.match(saveEmployee, /const targetOutlet=isDeveloper\(\)\?\(\(document\.getElementById\('eo'\)\?\.value\)\|\|await outInit\(\)\):await outInit\(\)/, 'Employee create must use the assigned outlet for non-developers');
assert.match(saveEmployee, /String\(division\.outlet_id\)!==String\(targetOutlet\)/, 'Employee create must reject a division from a different outlet');

const adminScope = section('function adminAccountScopes(uid){', 'function adminSelectAccount(uid)');
assert.match(adminScope, /String\(s\.outlet_id\)===String\(T\.adminOutletId\)/, 'Admin account scope view remains filtered to the current outlet');
assert.match(adminScope, /!x\.scope\.division_id\|\|x\.division/, 'Admin Divisi scope remains division-specific');

const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(script => script.trim().length > 0);
assert.ok(inlineScripts.length > 0, 'Inline JavaScript must exist');
inlineScripts.forEach((script, index) => {
  assert.doesNotThrow(() => new Function(script), 'Inline script ' + (index + 1) + ' must parse');
});

console.log('Access scope guardrails: OK');
console.log('Inline JavaScript syntax: OK (' + inlineScripts.length + ' scripts)');
