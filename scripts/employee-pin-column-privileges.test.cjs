#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const sql = fs.readFileSync('barapp_security_restrict_employee_pin_columns.sql', 'utf8');

const sensitive = ['pin_hash', 'pin_fail', 'pin_locked_until', 'pin_set_at'];
const expectedRead = ['id', 'name', 'role', 'active', 'created_at', 'outlet_id', 'division_id', 'deleted_at'];
const expectedInsert = ['name', 'role', 'active', 'outlet_id', 'division_id'];
const expectedUpdate = ['name', 'role', 'active', 'deleted_at'];

function grantColumns(kind) {
  const match = sql.match(new RegExp(
    'GRANT\\s+' + kind + '\\s*\\(([^)]*)\\)\\s*ON\\s+TABLE\\s+public\\.employees\\s+TO\\s+authenticated',
    'i'
  ));
  assert.ok(match, 'Missing column-level ' + kind + ' grant for authenticated on public.employees');
  return match[1].split(',').map(column => column.trim().toLowerCase()).filter(Boolean);
}
function sameColumns(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label + ' columns do not match the expected allowlist');
}
function objectColumns(source, verb) {
  const re = new RegExp("\\.from\\(['\"]employees['\"]\\)\\." + verb + "\\(\\s*\\{([^}]*)\\}", 'g');
  const found = [];
  for (const match of source.matchAll(re)) {
    for (const key of match[1].matchAll(/(?:^|[,\\s])([a-zA-Z_][a-zA-Z0-9_]*)\\s*:/g)) found.push(key[1].toLowerCase());
  }
  return [...new Set(found)];
}

assert.match(sql, /BEGIN\\s*;/i, 'Privilege migration must be transactional');
assert.match(sql, /COMMIT\\s*;/i, 'Privilege migration must be transactional');
assert.match(sql, /REVOKE\\s+SELECT\\s*,\\s*INSERT\\s*,\\s*UPDATE\\s+ON\\s+TABLE\\s+public\\.employees\\s+FROM\\s+authenticated/i,
  'Broad employee read/write grants must be revoked before allowlisting columns');

const readGrant = grantColumns('SELECT');
sameColumns(readGrant, expectedRead, 'Safe SELECT grant');
assert(!readGrant.some(column => sensitive.includes(column)), 'A PIN/lockout column must never be granted to browser reads');
sameColumns(grantColumns('INSERT'), expectedInsert, 'INSERT grant');
sameColumns(grantColumns('UPDATE'), expectedUpdate, 'UPDATE grant');

const projectionMatch = html.match(/const\\s+EMP_SAFE_SELECT\\s*=\\s*['"]([^'"]+)['"]/);
assert.ok(projectionMatch, 'Missing EMP_SAFE_SELECT frontend projection');
const projection = projectionMatch[1].split(',').map(column => column.trim().toLowerCase());
sameColumns(projection, readGrant, 'Frontend read projection');
assert(!projection.some(column => sensitive.includes(column)), 'Frontend projection must exclude all PIN/lockout columns');

assert.match(html, /const\\s+out\\s*=\\s*\[\]\s*,\s*cols\s*=\s*tbl\s*===\s*['"]employees['"]\s*\?\s*EMP_SAFE_SELECT\s*:\s*['"]\*['"]/,
  'Generic employee pagination must use the safe projection instead of SELECT *');

for (const verb of ['insert', 'update']) {
  const fields = objectColumns(html, verb);
  const granted = new Set(grantColumns(verb.toUpperCase()));
  const missing = fields.filter(field => !granted.has(field));
  assert.deepEqual(missing, [], 'Employee ' + verb.toUpperCase() + ' writes use columns not granted by the migration');
}
for (const match of html.matchAll(/\\.from\\(['"]employees['"]\\)\\.select\\(([^)]*)\\)/g)) {
  const args = match[1].trim();
  assert.notEqual(args, '', 'Employee queries must not call select() with an implicit wildcard');
  assert(!/(?:^|[,\\s])\\*(?:$|[,\\s])/.test(args), 'Employee query must not use SELECT *');
  assert(!sensitive.some(column => new RegExp('\\\\b' + column + '\\\\b', 'i').test(args)),
    'Employee query must not explicitly request PIN/lockout metadata');
}

console.log('Employee PIN-column privilege regression checks passed.');
