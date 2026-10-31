'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const closingSource = fs.readFileSync(path.join(root, 'closing.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migrationSource = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261024_add_atomic_operational_template_v2.sql'),
  'utf8'
);

assert.doesNotThrow(() => new Function(closingSource), 'closing.js must remain valid JavaScript');

// The current Excel feature is a Daily SO-only template for physical stock counts.
for (const marker of [
  'function opTDownload()',
  'function opTPreview(input)',
  'function opTConfirmImport()',
  'BARAPP_DAILY_SO_TEMPLATE_V1',
  'DAILY SO',
  'window.__clDownloadOperationalTemplate=opTDownload',
  'window.__clPreviewOperationalImport=opTPreview',
  'window.__clConfirmOperationalImport=opTConfirmImport',
  'barapp_closing_import_operational_template_v2',
  'opTPreferredUnit',
  'const dailyPhysicalTouched=mapped.some',
  'const supplyPhysicalTouched=mapped.some',
  'Hanya data Daily SO ITEM dan WIP yang akan diimpor.'
]) {
  assert.ok(closingSource.includes(marker), 'Missing Daily SO template marker: ' + marker);
}

assert.ok(closingSource.includes('function opTOpenFromDailySO()'), 'Daily SO template must open using the selected division and date');
assert.ok(closingSource.includes('window.__clOpenOperationalTemplateFromDailySO=opTOpenFromDailySO'), 'Daily SO button must be wired to its template opener');
assert.ok(closingSource.includes("ws.getCell('AA'+(i+1)).value=key"), 'Template metadata must remain separate from visible stock rows');
assert.ok(closingSource.includes("opTBlank(ws['F'+row]?.v)?0:opTNum(ws['F'+row]?.v)"), 'Blank item physical quantities must default to zero');
assert.ok(closingSource.includes("opTBlank(ws['D'+r]?.v)?0:opTNum(ws['D'+r]?.v)"), 'Blank WIP physical quantities must default to zero');
assert.ok(closingSource.includes('Hanya data Daily SO ITEM dan WIP yang akan diimpor.'), 'Import preview must clearly state its Daily SO-only scope');
assert.ok(closingSource.includes('if(dailyTouched){'), 'Daily SO must validate the complete active item set when physical counts are entered');
assert.ok(closingSource.includes('if(supplyTouched){'), 'Supplies must validate the complete active supply set when physical counts are entered');
assert.ok(closingSource.includes('await Promise.all([cgLoad(false),invLoad(false)])'), 'Successful import must refresh COGS and inventory caches');
assert.ok(closingSource.includes('await opsLoadPosition(false,true)'), 'Successful import must refresh the Daily SO stock position when applicable');
assert.equal(closingSource.includes('Template Operasional Barapp'), false, 'Legacy operational template title must not return');
assert.equal(closingSource.includes('Template Operasional (Excel)'), false, 'Legacy operational template button must not return');
assert.equal(closingSource.includes('STOCK OPNAME + BARANG MASUK'), false, 'Legacy multi-module template section must not return');
assert.equal(closingSource.includes('PENGELUARAN — 20 BARIS INPUT MANUAL'), false, 'Legacy expense template section must not return');
assert.equal(closingSource.includes('PENJUALAN MENU'), false, 'Legacy sales template section must not return');
assert.equal(closingSource.includes('PRODUKSI WIP + STOK FISIK AKHIR'), false, 'Legacy multi-module WIP section must not return');
assert.ok(closingSource.includes('window.__barappRegisterViews?.({cogs_closing:view})'), 'Closing view registration must remain reachable');

assert.ok(migrationSource.toLowerCase().includes('create or replace function public.barapp_closing_import_operational_template_v2'), 'Daily SO import RPC must remain available');
assert.ok(migrationSource.includes('public.cogs_save_daily_so'), 'Daily SO import must use the existing validated save function');
assert.ok(migrationSource.includes('revoke all on function public.barapp_closing_import_operational_template_v2'), 'Import RPC execute permissions must be explicitly restricted');
assert.ok(migrationSource.includes('grant execute on function public.barapp_closing_import_operational_template_v2'), 'Authenticated sessions must retain the intended import RPC access');

assert.match(indexSource, /<script src="\.\/closing\.js\?v=[^"]+"><\/script>/, 'The page must load the current closing.js file');
assert.ok(indexSource.includes('window.__clOpenOperationalTemplateFromDailySO()'), 'Daily SO page must expose the Daily SO template action');

console.log('Daily SO-only Excel template: all static QA checks passed.');
