'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const closingSource = fs.readFileSync(path.join(root, 'closing.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migrationSource = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261024_remove_approval_daily_so_template.sql'),
  'utf8'
);

assert.doesNotThrow(() => new Function(closingSource), 'closing.js remains valid JavaScript');
for (const symbol of [
  'clTemplateId',
  'clDownloadTemplate',
  'clPreviewTemplateImport',
  'clConfirmTemplateImport',
  '__clOpenTemplate',
  '__clDownloadTemplate',
  '__clPreviewTemplateImport',
  '__clConfirmTemplateImport',
  'barapp_closing_import_template',
  'Template Daily SO',
  'cl_template_file'
]) {
  assert.equal(closingSource.includes(symbol), false, 'Removed template reference: ' + symbol);
}
assert.equal(indexSource.includes('window.__clOpenTemplate'), false, 'Approval UI must not call the removed template feature');
assert.match(indexSource, /closing\.js\?v=20261024-remove-approval-daily-so-template-v1/);
assert.match(migrationSource, /drop function if exists public\.barapp_closing_import_template\(uuid,\s*date,\s*uuid,\s*jsonb\)/i);
assert.match(migrationSource, /drop table if exists public\.barapp_closing_template_imports/i);

console.log('Approval Daily SO template removal: all checks passed.');
