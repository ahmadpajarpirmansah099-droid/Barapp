'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const closingSource = fs.readFileSync(path.join(root, 'public/closing.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migrationSource = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261024_add_atomic_operational_template_v2.sql'),
  'utf8'
);

function collectJavaScriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

const publicJavaScriptFiles = collectJavaScriptFiles(path.join(root, 'public'));
assert.ok(publicJavaScriptFiles.length > 0, 'Expected JavaScript files under public/');
for (const filePath of publicJavaScriptFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.doesNotThrow(
    () => new Function(source),
    path.relative(root, filePath) + ' must remain valid JavaScript'
  );
}
console.log(`Syntax check passed for ${publicJavaScriptFiles.length} JavaScript files under public/.`);

assert.doesNotThrow(() => new Function(closingSource), 'closing.js must remain valid JavaScript');

for (const marker of [
  'async function opTDownload()',
  'async function opTPreview(input)',
  'async function opTConfirmImport()',
  'BARAPP_DAILY_SO_TEMPLATE_V1',
  'window.__clDownloadOperationalTemplate=opTDownload',
  'window.__clPreviewOperationalImport=opTPreview',
  'window.__clConfirmOperationalImport=opTConfirmImport',
  'barapp_closing_import_operational_template_v2',
  'opTPreferredUnit'
]) {
  assert.ok(closingSource.includes(marker), 'Missing Daily SO template marker: ' + marker);
}

assert.match(closingSource, /Template Daily SO hanya menerima Stok Fisik Akhir\. Barang Masuk dan Total Invoice tidak boleh diisi/, 'Stock rows must reject stock-in and invoice input');
assert.match(closingSource, /Template Daily SO hanya menerima Stok Fisik Akhir\. Produksi Aktual tidak boleh diisi/, 'WIP rows must reject production input');
assert.ok(closingSource.includes("mapped.some(x=>!['STOCK','WIP'].includes(x.section))"), 'Non-stock template sections must be rejected');
assert.ok(closingSource.includes("const actual=opTBlank(ws['F'+row]?.v)?0:opTNum(ws['F'+row]?.v)"), 'Item physical stock is the only accepted stock-row quantity');
assert.ok(closingSource.includes("const actual=opTBlank(ws['D'+r]?.v)?0:opTNum(ws['D'+r]?.v)"), 'WIP physical stock is the only accepted WIP quantity');
const previewStart = closingSource.indexOf('async function opTPreview(input)');
const previewEnd = closingSource.indexOf('function opTRenderPreview()', previewStart);
assert.ok(previewStart >= 0 && previewEnd > previewStart, 'Daily SO preview/import validator must be present');
const previewSource = closingSource.slice(previewStart, previewEnd);
const metadataGuard = previewSource.indexOf("mapped.some(x=>!['STOCK','WIP'].includes(x.section))");
assert.ok(metadataGuard >= 0, 'Non-stock metadata sections must be rejected by the import validator');
assert.ok(metadataGuard < previewSource.indexOf("mapped.filter(x=>x.section==='STOCK')"), 'Metadata rejection must happen before row processing');
assert.ok(metadataGuard < previewSource.indexOf("mapped.filter(x=>x.section==='WIP')"), 'Metadata rejection must happen before WIP processing');
const stockRowsStart = previewSource.indexOf("mapped.filter(x=>x.section==='STOCK')");
const stockRowsEnd = previewSource.indexOf("if(dailyTouched){", stockRowsStart);
const stockRowsSource = previewSource.slice(stockRowsStart, stockRowsEnd);
assert.ok(stockRowsStart >= 0 && stockRowsEnd > stockRowsStart, 'Stock physical-count validation block must be present');
assert.equal(stockRowsSource.includes('p.stock_in.push('), false, 'Stock rows must not create stock-in transactions');
const wipRowsStart = previewSource.indexOf("mapped.filter(x=>x.section==='WIP')");
const wipRowsEnd = previewSource.indexOf("if(dailyTouched){", wipRowsStart);
const wipRowsSource = previewSource.slice(wipRowsStart, wipRowsEnd);
assert.ok(wipRowsStart >= 0 && wipRowsEnd > wipRowsStart, 'WIP physical-count validation block must be present');
assert.equal(wipRowsSource.includes('p.production.push('), false, 'WIP rows must not create production transactions');
assert.ok(closingSource.includes("['Nama Barang','Jenis Master','Satuan Input','','','Stok Fisik Akhir (Qty)','Catatan']"), 'Item template exposes only physical stock as an input');
assert.ok(closingSource.includes("['Nama WIP','Satuan Hasil','','Stok Fisik Akhir (Qty)','Catatan']"), 'WIP template exposes only physical stock as an input');
assert.ok(closingSource.includes("window.__clOpenOperationalTemplateFromDailySO=opTOpenFromDailySO"), 'Daily SO template opener remains wired');

assert.ok(migrationSource.toLowerCase().includes('create or replace function public.barapp_closing_import_operational_template_v2'), 'Existing atomic import RPC remains available');
assert.ok(migrationSource.includes('revoke all on function public.barapp_closing_import_operational_template_v2'), 'RPC execute permissions remain restricted');
assert.ok(migrationSource.includes('grant execute on function public.barapp_closing_import_operational_template_v2'), 'RPC remains available to authenticated sessions');

const confirmStart = closingSource.indexOf('async function opTConfirmImport()');
const confirmEnd = closingSource.indexOf('window.__clOpenOperationalTemplate=opTOpenDialog', confirmStart);
assert.ok(confirmStart >= 0 && confirmEnd > confirmStart, 'Daily SO confirmation handler must be present');
const confirmSource = closingSource.slice(confirmStart, confirmEnd);
const saveSuccess = confirmSource.indexOf("if(error)throw error;");
const closePreview = confirmSource.indexOf("closeM();", saveSuccess);
const refreshAttempt = confirmSource.indexOf("await Promise.all([cgLoad(false),invLoad(false)])", closePreview);
assert.ok(saveSuccess >= 0, 'Import handler must check the database save result');
assert.ok(closePreview > saveSuccess, 'Import preview must close only after the database confirms a successful save');
assert.ok(refreshAttempt > closePreview, 'Preview must close before refreshing screen data');
assert.equal(confirmSource.slice(0, saveSuccess).includes("closeM();"), false, 'Preview must remain open before the save succeeds');
assert.match(indexSource, /closing\.js\?v=/, 'The app must load the versioned closing script from public assets');

console.log('Daily SO-only Excel import: all static QA checks passed.');
