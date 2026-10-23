'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const closingSource = fs.readFileSync(path.join(root, 'closing.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

new Function(closingSource);

for (const symbol of [
  'clTemplate',
  'clOpenTemplate',
  'clDownloadTemplate',
  'clPreviewTemplateImport',
  'clPreviewLegacyTemplateImport',
  'clConfirmTemplateImport',
  'clRenderTemplatePreview',
  'clEnsureExcelJS',
  '__clOpenTemplate',
  '__clDownloadTemplate',
  '__clPreviewTemplateImport',
  '__clConfirmTemplateImport',
  'BARAPP_DAILY_SO_TEMPLATE_V3',
  'BARAPP_DAILY_SO_TEMPLATE_V4',
  'barapp_closing_import_template',
  'Template Daily SO'
]) {
  assert(!closingSource.includes(symbol), 'Approval Closing template code remains: ' + symbol);
}

assert(!/window\\.__clOpenTemplate|window\\.__clDownloadTemplate|window\\.__clPreviewTemplateImport|window\\.__clConfirmTemplateImport/.test(indexSource),
  'Approval Closing template entrypoint remains in index.html');

for (const symbol of ['function confirmModule(', 'async function approve(', 'function view()', 'window.__clApprove', 'window.__clDownloadClosingExcel']) {
  assert(closingSource.includes(symbol), 'Unrelated Approval Closing functionality should remain: ' + symbol);
}

assert(indexSource.includes('closing.js?v=20261024-no-closing-template'),
  'Approval Closing script cache version was not refreshed');

console.log('Approval Closing template removal checks passed.');
