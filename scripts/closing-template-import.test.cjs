'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const closingSource = fs.readFileSync(path.join(root, 'closing.js'), 'utf8');
new Function(closingSource);

const start = closingSource.indexOf('function clTemplateId(){');
const end = closingSource.indexOf('\nfunction view(){', start);
assert(start >= 0 && end > start, 'Could not isolate Approval Closing template importer.');
const importerSource = closingSource.slice(start, end);

const DIVISION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUTLET_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TARGET_DIVISION_ID = '12121212-1212-4121-8121-121212121212';
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

function cloneWorkbook(wb) {
  return {
    SheetNames: wb.SheetNames.slice(),
    Sheets: Object.fromEntries(Object.entries(wb.Sheets).map(([name, sheet]) => [
      name,
      Object.assign({}, sheet, { rows: sheet.rows.map(row => row.slice()) })
    ])),
    Workbook: JSON.parse(JSON.stringify(wb.Workbook || {}))
  };
}

function setCell(wb, sheet, row, column, value) {
  wb.Sheets[sheet].rows[row][column] = value;
}

function createHarness(options = {}) {
  const generated = {};
  const div = { id: DIVISION_ID, name: 'Outlet Test', outlet_id: OUTLET_ID, active: true };
  const target = { id: TARGET_DIVISION_ID, name: 'Kitchen', outlet_id: OUTLET_ID, active: true };
  const items = options.items || [
    { id: id(1), division_id: DIVISION_ID, name: 'Coffee Beans', base_unit: 'g', active: true, is_supply: false, created_at: '2026-01-01', conversions: [{ unit: 'g', factor: 1 }] },
    { id: id(2), division_id: DIVISION_ID, name: 'Glass Cloth', base_unit: 'pcs', active: true, is_supply: true, created_at: '2026-01-01', conversions: [{ unit: 'pcs', factor: 1 }] }
  ];
  const wips = options.wips || [
    { id: id(3), division_id: DIVISION_ID, name: 'Cold Brew', yield_unit: 'L', yield_qty: 10, active: true, created_at: '2026-01-01' }
  ];
  const menus = options.menus || [
    { id: id(4), division_id: DIVISION_ID, name: 'Iced Latte', active: true }
  ];
  const CL = {
    division: DIVISION_ID, date: '2026-10-20', period: null,
    templateDraft: null, busy: '', ready: true, history: [], modules: [],
    snapshots: {}, loading: false, error: ''
  };
  const INV = {
    ready: true, items, divs: [div, target], ins: [], rets: [],
    stockOut: [], suppliesSO: [], productionBatches: []
  };
  const CG = {
    ready: true, wips, menus, divs: [div, target], sales: [],
    productions: [], dailySO: []
  };
  const XLSX = {
    utils: {
      book_new: () => ({ SheetNames: [], Sheets: {} }),
      aoa_to_sheet: rows => ({ rows: rows.map(row => row.slice()) }),
      book_append_sheet: (wb, sheet, name) => {
        wb.SheetNames.push(name);
        wb.Sheets[name] = sheet;
      },
      encode_range: () => 'A1:A1',
      encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + String(r + 1),
      sheet_to_json: (sheet, options = {}) => {
        if (options.header === 1) return sheet.rows;
        const headers = sheet.rows[0] || [];
        return sheet.rows.slice(1).map(row => Object.fromEntries(
          headers.map((header, index) => [header, row[index] === undefined ? '' : row[index]])
        ));
      }
    },
    writeFile: (wb, filename) => {
      Object.assign(generated, wb);
      generated.filename = filename;
    },
    read: () => generated
  };
  const window = {
    XLSX,
    crypto: { randomUUID: () => '99999999-9999-4999-8999-999999999999' }
  };
  const toastMessages = [];
  const modalMessages = [];
  const sb = () => ({
    from() { return this; },
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: null, error: null }),
    rpc: async () => { throw new Error('Import parser test must not call a write RPC.'); }
  });
  const api = new Function(
    'CL', 'INV', 'CG', 'window', 'XLSX', 'clDivision', 'clCanAccess',
    'clModuleOn', 'clToday', 'count', 'toast', 'esc', 'modal', 'closeM',
    'confirm', 'sb', 'opsErr', 'R', 'pg', 'isDeveloper', 'hasFeature',
    'cgLoad', 'invLoad', 'invAlpha', 'IC', 'T', 'adm', 'guard', 'go',
    importerSource + '\nreturn { clDownloadTemplate, clPreviewTemplateImport };'
  )(
    CL, INV, CG, window, XLSX,
    value => String(value) === DIVISION_ID ? div : String(value) === TARGET_DIVISION_ID ? target : null,
    () => true,
    () => true,
    () => '2026-10-21',
    () => 0,
    message => toastMessages.push(String(message)),
    value => String(value),
    message => modalMessages.push(String(message)),
    () => {},
    () => true,
    sb,
    error => String(error && error.message || error),
    () => {},
    'cogs_closing',
    () => true,
    () => true,
    async () => {},
    async () => {},
    (a, b) => String(a).localeCompare(String(b)),
    () => '',
    {},
    () => true,
    () => {},
    () => {}
  );
  return { api, CL, INV, CG, generated, toastMessages, modalMessages };
}

async function makeTemplate(harness) {
  harness.api.clDownloadTemplate();
  assert(harness.generated.Sheets, 'Template generation did not produce a workbook.');
  return cloneWorkbook(harness.generated);
}

async function preview(harness, workbook, filename = 'test.xlsx') {
  Object.assign(harness.generated, workbook);
  await harness.api.clPreviewTemplateImport({
    files: [{
      name: filename,
      size: 1024,
      arrayBuffer: async () => new ArrayBuffer(0)
    }]
  });
  assert(harness.CL.templateDraft, 'Preview did not produce an import plan.');
  return harness.CL.templateDraft;
}

function blankQuantities(wb) {
  const quantityColumn = {
    'Daily SO': 2, 'Penjualan': 1, 'Barang Masuk': 2,
    'Pengeluaran': 2, 'Produksi WIP': 3, 'Supplies': 2
  };
  Object.entries(quantityColumn).forEach(([sheet, column]) => {
    for (let row = 1; row < wb.Sheets[sheet].rows.length; row++) {
      setCell(wb, sheet, row, column, '');
    }
  });
  return wb;
}

async function main() {
  // The template stays at six visible sheets, with metadata preserved but hidden.
  const basic = createHarness();
  const base = await makeTemplate(basic);
  const visible = base.SheetNames.filter(name => !(base.Workbook.Sheets || []).some(sheet => sheet.name === name && sheet.Hidden === 1));
  assert.deepEqual(visible, ['Daily SO', 'Penjualan', 'Barang Masuk', 'Pengeluaran', 'Produksi WIP', 'Supplies']);
  assert.equal((base.Workbook.Sheets || []).find(sheet => sheet.name === '_META')?.Hidden, 1);
  assert(base.Sheets._META.rows.some(row => row[0] === 'TARGET_DATE' && row[1] === '2026-10-20'));

  // Complete mixed workbook passes and correctly maps zero-valued stock counts to the RPC payload.
  const valid = cloneWorkbook(base);
  for (let row = 1; row < valid.Sheets['Daily SO'].rows.length; row++) setCell(valid, 'Daily SO', row, 2, 0);
  setCell(valid, 'Penjualan', 1, 1, 2);
  setCell(valid, 'Barang Masuk', 1, 2, 2);
  setCell(valid, 'Pengeluaran', 1, 2, 1);
  setCell(valid, 'Pengeluaran', 1, 3, 'Waste');
  setCell(valid, 'Produksi WIP', 1, 3, 1);
  for (let row = 1; row < valid.Sheets.Supplies.rows.length; row++) setCell(valid, 'Supplies', row, 2, 0);
  const accepted = await preview(basic, valid, 'mixed.xlsx');
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.payload.daily_so.length, 2);
  assert(accepted.payload.daily_so.every(row => row.qty === 0));
  assert.equal(accepted.payload.sales.length, 1);
  assert.equal(accepted.payload.stock_in.length, 1);
  assert.equal(accepted.payload.stock_out.length, 1);
  assert.equal(accepted.payload.production.length, 1);
  assert.equal(accepted.payload.supplies[0].qty, 0);
  assert.equal(accepted.payload.supplies[0].actual_qty_base, 0);

  // Partial-sheet import is supported without requiring untouched quantity columns.
  const salesHarness = createHarness();
  const salesBook = blankQuantities(await makeTemplate(salesHarness));
  setCell(salesBook, 'Penjualan', 1, 1, 3);
  const salesOnly = await preview(salesHarness, salesBook, 'sales-only.xlsx');
  assert.deepEqual(salesOnly.errors, []);
  assert.equal(salesOnly.payload.sales.length, 1);
  assert.equal(salesOnly.payload.daily_so.length, 0);
  assert.equal(salesOnly.payload.supplies.length, 0);

  // Zero is a real count, but a partially filled Daily SO cannot be imported.
  const partialHarness = createHarness();
  const partialBook = await makeTemplate(partialHarness);
  setCell(partialBook, 'Daily SO', 1, 2, 0);
  const partial = await preview(partialHarness, partialBook, 'partial-daily.xlsx');
  assert(partial.errors.some(error => error.includes('Daily SO: jika sheet ini dipakai')));

  // Reject stale master units and stale displayed WIP yield details.
  const staleUnitHarness = createHarness();
  const staleUnitBook = await makeTemplate(staleUnitHarness);
  setCell(staleUnitBook, 'Daily SO', 1, 1, 'kg');
  const staleUnit = await preview(staleUnitHarness, staleUnitBook, 'stale-unit.xlsx');
  assert(staleUnit.errors.some(error => error.includes('Satuan dasar berubah')));

  const staleSupplyHarness = createHarness();
  const staleSupplyBook = await makeTemplate(staleSupplyHarness);
  setCell(staleSupplyBook, 'Supplies', 1, 1, 'box');
  const staleSupply = await preview(staleSupplyHarness, staleSupplyBook, 'stale-supply.xlsx');
  assert(staleSupply.errors.some(error => error.includes('Satuan dasar berubah')));

  const staleYieldHarness = createHarness();
  const staleYieldBook = await makeTemplate(staleYieldHarness);
  setCell(staleYieldBook, 'Produksi WIP', 1, 1, 11);
  const staleYield = await preview(staleYieldHarness, staleYieldBook, 'stale-yield.xlsx');
  assert(staleYield.errors.some(error => error.includes('Hasil per batch berubah')));

  // Metadata, hidden catalogue IDs, and duplicate master references must not silently pass.
  const wrongDivisionHarness = createHarness();
  const wrongDivisionBook = await makeTemplate(wrongDivisionHarness);
  wrongDivisionBook.Sheets._META.rows.find(row => row[0] === 'DIVISION_ID')[1] = TARGET_DIVISION_ID;
  const wrongDivision = await preview(wrongDivisionHarness, wrongDivisionBook, 'wrong-division.xlsx');
  assert(wrongDivision.errors.some(error => error.includes('divisi berbeda')));

  const wrongDateHarness = createHarness();
  const wrongDateBook = await makeTemplate(wrongDateHarness);
  wrongDateBook.Sheets._META.rows.find(row => row[0] === 'TARGET_DATE')[1] = '2026-10-19';
  const wrongDate = await preview(wrongDateHarness, wrongDateBook, 'wrong-date.xlsx');
  assert(wrongDate.errors.some(error => error.includes('tanggal closing terpilih')));

  const duplicateHarness = createHarness();
  const duplicateBook = await makeTemplate(duplicateHarness);
  for (let row = 1; row < duplicateBook.Sheets['Daily SO'].rows.length; row++) setCell(duplicateBook, 'Daily SO', row, 2, 0);
  duplicateBook.Sheets['Daily SO'].rows[2][3] = duplicateBook.Sheets['Daily SO'].rows[1][3];
  const duplicate = await preview(duplicateHarness, duplicateBook, 'duplicate.xlsx');
  assert(duplicate.errors.some(error => error.includes('daftar item/menu berubah')));

  // Move accepts a unique destination division in the same outlet, and rejects the source division itself.
  const moveHarness = createHarness();
  const moveBook = blankQuantities(await makeTemplate(moveHarness));
  setCell(moveBook, 'Pengeluaran', 1, 2, 1);
  setCell(moveBook, 'Pengeluaran', 1, 3, 'Move');
  setCell(moveBook, 'Pengeluaran', 1, 4, 'Kitchen');
  const move = await preview(moveHarness, moveBook, 'move.xlsx');
  assert.deepEqual(move.errors, []);

  const selfMoveHarness = createHarness();
  const selfMoveBook = blankQuantities(await makeTemplate(selfMoveHarness));
  setCell(selfMoveBook, 'Pengeluaran', 1, 2, 1);
  setCell(selfMoveBook, 'Pengeluaran', 1, 3, 'Move');
  setCell(selfMoveBook, 'Pengeluaran', 1, 4, 'Outlet Test');
  const selfMove = await preview(selfMoveHarness, selfMoveBook, 'self-move.xlsx');
  assert(selfMove.errors.some(error => error.includes('DIVISI_TUJUAN harus nama divisi lain')));

  // Frontend must stop workbook row counts that the atomic SQL RPC rejects.
  const manyItems = Array.from({ length: 1001 }, (_, index) => ({
    id: id(10000 + index), division_id: DIVISION_ID, name: 'Material ' + (index + 1),
    base_unit: 'g', active: true, is_supply: false, created_at: '2026-01-01',
    conversions: [{ unit: 'g', factor: 1 }]
  }));
  const rowCapHarness = createHarness({ items: manyItems, wips: [], menus: [] });
  const oversizedBook = await makeTemplate(rowCapHarness);
  for (let row = 1; row < oversizedBook.Sheets['Daily SO'].rows.length; row++) setCell(oversizedBook, 'Daily SO', row, 2, 1);
  const oversized = await preview(rowCapHarness, oversizedBook, 'too-many-daily-rows.xlsx');
  assert.equal(oversized.payload.daily_so.length, 1001);
  assert(oversized.errors.some(error => error.includes('Daily SO: maksimal 1000')));

  console.log('Approval Closing Excel importer: all tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
