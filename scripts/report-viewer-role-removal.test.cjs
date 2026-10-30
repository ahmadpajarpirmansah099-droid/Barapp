'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261030120700_remove_report_viewer_role.sql'),
  'utf8'
);

assert.doesNotMatch(html, /report_viewer/i,
  'Frontend must not retain the retired report_viewer role');

const roleConstraint = sql.match(
  /ADD CONSTRAINT user_profiles_role_check[\s\S]*?\);/i
);
assert.ok(roleConstraint, 'Migration must recreate user_profiles_role_check');
assert.doesNotMatch(roleConstraint[0], /report_viewer/i,
  'The role constraint must reject report_viewer');
for (const role of ['dev', 'hr', 'div_admin', 'legacy_admin', 'guest_arrival']) {
  assert.match(roleConstraint[0], new RegExp("'" + role + "'"),
    'The migration must preserve supported role ' + role);
}

assert.match(sql, /WHERE role = 'report_viewer'[\s\S]*?RAISE EXCEPTION/i,
  'Migration must fail closed if any report_viewer account remains');
assert.match(sql, /DROP FUNCTION IF EXISTS public\.dev_assign_report_viewer\(text\)/i,
  'The retired assignment RPC must be removed');

const functionNames = [
  'has_perm',
  'can_access_scope',
  'barapp_can_access_division',
  'cogs_ops_can_access_division',
  'cogs_assert_ops_division',
  'cogs_cancel_operation',
  'cogs_list_materials',
  'dev_set_account'
];

for (const name of functionNames) {
  const pattern = new RegExp(
    'CREATE OR REPLACE FUNCTION public\\.' + name +
    '\\b[\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;',
    'i'
  );
  const match = sql.match(pattern);
  assert.ok(match, 'Migration must redefine public.' + name);
  assert.doesNotMatch(match[1], /report_viewer/i,
    'public.' + name + ' must not authorize report_viewer');
}

for (const policy of [
  'p_att_delete_feature',
  'p_div_sel',
  'p_att_select_feature',
  'p_emp_select_feature'
]) {
  const match = sql.match(new RegExp(
    'ALTER POLICY ' + policy + '\\b[\\s\\S]*?;', 'i'
  ));
  assert.ok(match, 'Migration must update policy ' + policy);
  assert.doesNotMatch(match[0], /report_viewer/i,
    'Policy ' + policy + ' must not reference report_viewer');
}

// Keep these independent feature permissions: both are still assigned to an
// active HR account and are not the retired role itself.
assert.match(html, /attendance\.report\.view/,
  'Keep the independent attendance report permission');
assert.match(html, /employees\.directory\.view/,
  'Keep the independent employee directory permission');

console.log('report_viewer retirement static checks: PASS');
