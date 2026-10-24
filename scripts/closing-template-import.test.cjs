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

for (const marker of [
  'function opTDownload()',
  'function opTPreview(input)',
  'function opTConfirmImport()',
  'Template Operasional Barapp',
  'BARAPP_OPERATIONAL_TEMPLATE_V2',
  'STOCK OPNAME + BARANG MASUK',
  'PENGELUARAN — 20 BARIS INPUT MANUAL',
  'PENJUALAN MENU',
  'PRODUKSI WIP + STOK AKHIR WIP',
  'RETUR KE SUPPLIER',
  'SUPPLIES',
  'window.__clDownloadOperationalTemplate=opTDownload',
  'window.__clPreviewOperationalImport=opTPreview',
  'window.__clConfirmOperationalImport=opTConfirmImport',
  'barapp_closing_import_operational_template_v2',
  'stock_returns',
  'opTPreferredUnit'
]) {
  assert.ok(closingSource.includes(marker), 'Missing operational template marker: ' + marker);
}

assert.ok(closingSource.includes("'SKM':'CAN'"), 'SKM uses CAN default');
assert.ok(closingSource.includes("'SKMCOKLAT':'PACK'"), 'SKM Coklat uses PACK default');
assert.ok(closingSource.includes("'GALONAQUA':'GALON'"), 'Galon Aqua uses GALON default');
assert.ok(closingSource.includes("'GALONVIT':'GALON'"), 'Galon Vit uses GALON default');
assert.ok(closingSource.includes("'ESBATUATLAS':'BALL'"), 'Es Batu Atlas uses BALL default');
assert.ok(closingSource.includes("'GINGERALE':'CAN'"), 'Gingerale uses CAN default');
assert.ok(closingSource.includes("ws.getCell('AA'+(i+1)).value=key"), 'Template metadata does not overwrite row IDs');
assert.ok(closingSource.includes("const expenseStart=Number(ws['BD1']?.v||0),expenseLast=Number(ws['BD2']?.v||0)"), 'Expense input range is present in hidden metadata');
assert.ok(closingSource.includes("cogs_save_daily_so") === false, 'V2 must use one atomic import RPC, not separate per-section client writes');

assert.ok(migrationSource.includes('create table if not exists public.barapp_closing_operational_template_imports'), 'V2 import audit table must be created');
assert.ok(migrationSource.toLowerCase().includes('create or replace function public.barapp_closing_import_operational_template_v2'), 'V2 atomic import RPC must be created');
assert.match(migrationSource, /security definer/i, 'RPC must run with its protected database owner');
assert.ok(migrationSource.includes('public.cogs_save_daily_so'), 'Daily SO is saved using the existing validated RPC');
assert.ok(migrationSource.includes('public.cogs_record_menu_sales_batch'), 'Sales uses the existing validated batch RPC');
assert.ok(migrationSource.includes('public.cogs_record_production_batch'), 'WIP production uses the existing validated batch RPC');
assert.ok(migrationSource.includes('public.barapp_supplies_save_so'), 'Supplies uses the existing validated RPC');
assert.ok(migrationSource.includes('public.barapp_stock_returns'), 'Supplier returns are included in the same DB transaction');
assert.ok(migrationSource.includes('revoke all on function public.barapp_closing_import_operational_template_v2'), 'RPC execute permissions are explicitly restricted');
assert.match(migrationSource, /\$function\$;\s*revoke all on function public\.barapp_closing_import_operational_template_v2/i, 'Function terminator must be complete before permissions are changed');
assert.ok(migrationSource.includes('grant execute on function public.barapp_closing_import_operational_template_v2'), 'RPC is available to authenticated sessions');

assert.ok(indexSource.includes('closing.js?v=20261024-approval-operational-template-v3'), 'The app must load the new operational template script version');
assert.ok(closingSource.includes('Template Operasional (Excel)'), 'Approval UI should expose the single operational-template action');
assert.equal(closingSource.includes('Stok Awal WIP (Qty)'), false, 'Operational template must not request opening WIP stock');
assert.equal(closingSource.includes('RETUR KE SUPPLIER'), false, 'Operational template must not expose supplier returns');
assert.equal(closingSource.includes("section==='RETURNS'"), false, 'Operational template must not parse supplier return rows');
assert.ok(closingSource.includes("['Nama WIP','Satuan Hasil','Produksi Aktual (Qty)','Stok Fisik Akhir (Qty)','Catatan']"), 'WIP template should contain production and physical ending stock only');
assert.equal(closingSource.includes('clExportDailySOTemplate'), false, 'Removed Daily SO-only template binding must not break registration');
assert.equal(closingSource.includes('clImportDailySO'), false, 'Removed Daily SO-only importer must not remain referenced');
assert.ok(closingSource.includes('window.__barappRegisterViews?.({cogs_closing:view})'), 'Closing view registration must remain reachable after function binding');
assert.equal(indexSource.includes('window.__clOpenTemplate'), false, 'Legacy single-template entry point must not be used');

console.log('Approval Closing single-sheet operational Excel template v2: all static QA checks passed.');
