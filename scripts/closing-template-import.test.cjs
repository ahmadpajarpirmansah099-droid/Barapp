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
  // Existing test column indexes refer to the pre-date-column worksheet layout.
  wb.Sheets[sheet].rows[row][column + (sheet === '_META' ? 0 : 1)] = value;
}

function createHarness(options = {}) {
  const generated = {};
  const rpcCalls = [];
  const counters = { loads: 0 };
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
      sheet_to_json: (sheet, options = {}) => {
        if (options.header === 1) return sheet.rows;
        const headers = sheet.rows[0] || [];
        return sheet.rows.slice(1).map(row => Object.fromEntries(
          headers.map((header, index) => [header, row[index] === undefined ? '' : row[index]])
        ));
      }
    },
    read: () => generated
  };
  class MockWorksheet {
    constructor(name) {
      this.name = name;
      this.rows = [];
      this.cellMeta = {};
      this.columns = {};
      this.state = 'visible';
      this.views = [];
    }
    addRow(values) {
      this.rows.push(values.slice());
      return this.getRow(this.rows.length);
    }
    getRow(number) {
      const ws = this;
      return {
        set height(value) { ws.rowHeights = ws.rowHeights || {}; ws.rowHeights[number] = value; },
        eachCell(callback) {
          (ws.rows[number - 1] || []).forEach((_, index) => callback(ws.getCell(number, index + 1), index + 1));
        }
      };
    }
    getCell(row, column) {
      const key = row + ':' + column;
      if (!this.cellMeta[key]) this.cellMeta[key] = {};
      return this.cellMeta[key];
    }
    getColumn(number) {
      if (!this.columns[number]) this.columns[number] = { width: 18, hidden: false };
      return this.columns[number];
    }
  }
  class MockWorkbook {
    constructor() {
      this.worksheets = [];
      this.definedNames = { ranges: [], add: (reference, name) => this.definedNames.ranges.push({ reference, name }) };
      this.xlsx = {
        writeBuffer: async () => {
          generated.SheetNames = this.worksheets.map(ws => ws.name);
          generated.Sheets = Object.fromEntries(this.worksheets.map(ws => {
            const validations = {};
            Object.entries(ws.cellMeta).forEach(([key, cell]) => {
              if (cell.dataValidation) validations[key] = JSON.parse(JSON.stringify(cell.dataValidation));
            });
            return [ws.name, {
              rows: ws.rows.map(row => row.slice()),
              validations,
              '!cols': Object.entries(ws.columns).map(([index, column]) => ({ index: Number(index), width: column.width, hidden: column.hidden }))
            }];
          }));
          generated.Workbook = { Sheets: this.worksheets.map(ws => ({ name: ws.name, Hidden: ws.state === 'hidden' ? 1 : 0 })) };
          generated.definedNames = this.definedNames.ranges.slice();
          return new Uint8Array([80, 75, 3, 4]).buffer;
        }
      };
    }
    addWorksheet(name) {
      const worksheet = new MockWorksheet(name);
      this.worksheets.push(worksheet);
      return worksheet;
    }
  }
  const ExcelJS = { Workbook: MockWorkbook };
  const window = {
    XLSX,
    ExcelJS,
    crypto: { randomUUID: () => '99999999-9999-4999-8999-999999999999' }
  };
  const fakeDocument = {
    head: { appendChild() { throw new Error('ExcelJS should already be loaded by the test harness.'); } },
    body: { appendChild() {} },
    createElement() {
      return {
        href: '',
        download: '',
        click() { generated.downloadName = this.download; },
        remove() {}
      };
    }
  };
  const fakeURL = { createObjectURL: () => 'blob:barapp-test', revokeObjectURL: () => {} };
  const toastMessages = [];
  const modalMessages = [];
  const sb = () => ({
    from() { return this; },
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: null, error: null }),
    rpc: async (name, args) => {
      if (!options.allowRpc) throw new Error('Unexpected RPC call in parser-only test.');
      rpcCalls.push({ name, args });
      return options.rpcResult || { data: { summary: {} }, error: null };
    }
  });
  const api = new Function(
    'CL', 'INV', 'CG', 'window', 'XLSX', 'clDivision', 'clCanAccess',
    'clModuleOn', 'clToday', 'count', 'toast', 'esc', 'modal', 'closeM',
    'confirm', 'sb', 'opsErr', 'R', 'pg', 'isDeveloper', 'hasFeature',
    'cgLoad', 'invLoad', 'invAlpha', 'IC', 'T', 'adm', 'guard', 'go', 'load',
    'document', 'Blob', 'URL',
    importerSource + '\nreturn { clDownloadTemplate, clPreviewTemplateImport, clConfirmTemplateImport };'
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
    () => {},
    async () => { counters.loads++; },
    fakeDocument,
    Blob,
    fakeURL
  );
  return { api, CL, INV, CG, generated, toastMessages, modalMessages, rpcCalls, counters, options };
}

async function makeTemplate(harness) {
  await harness.api.clDownloadTemplate();
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

function mapRows(book, section) {
  return book.Sheets._META.rows
    .filter(row => String(row[2] || '').trim() === section)
    .map(row => ({ row: Number(row[3]), id: String(row[4]), type: String(row[5]), name: String(row[6]), unit: String(row[7]), yieldQty: row[8] === '' ? null : Number(row[8]) }));
}

function setExcelCell(book, sheet, excelRow, excelColumn, value) {
  const row = book.Sheets[sheet].rows[excelRow - 1];
  while (row.length < excelColumn) row.push('');
  row[excelColumn - 1] = value;
}

async function main() {
  const baseHarness = createHarness();
  const base = await makeTemplate(baseHarness);
  const visible = base.SheetNames.filter(name => !(base.Workbook.Sheets || []).some(sheet => sheet.name === name && sheet.Hidden === 1));
  assert.deepEqual(visible, ['Daily SO'], 'only the visual Daily SO template is visible');
  assert.equal(base.Workbook.Sheets.find(sheet => sheet.name === '_META')?.Hidden, 1);
  assert.equal(base.Workbook.Sheets.find(sheet => sheet.name === '_LISTS')?.Hidden, 1);
  assert.deepEqual(base.Sheets['Daily SO'].rows[0].slice(0, 9), [
    'DATE', 'ITEM', 'MASUK', 'AKHIR', 'UNIT',
    'BARANG KELUAR', 'JUMLAH', 'KATEGORI', 'KETERANGAN'
  ]);
  assert.equal(base.Sheets['Daily SO'].rows[1][1] ?? '', '');
  assert.equal(base.Sheets['Daily SO'].rows[1][5] ?? '', '');
  assert.equal(base.Sheets['Daily SO'].rows[25][5] ?? '', '');
  assert.equal(base.Sheets['Daily SO'].validations['2:6']?.type, 'list', 'expense ITEM dropdown exists');
  assert.equal(base.Sheets['Daily SO'].validations['2:8']?.type, 'list', 'expense KATEGORI dropdown exists');
  assert.equal(base.Sheets['Daily SO'].validations['26:6']?.type, 'list', 'ITEM dropdown covers row 25 of expenses');
  assert.equal(base.Sheets['Daily SO'].validations['26:8']?.type, 'list', 'category dropdown covers row 25 of expenses');
  assert(base.Sheets._LISTS.rows.slice(1).some(row => row[0] === 'Coffee Beans' && row[1] === id(1)));
  assert(base.Sheets._LISTS.rows.slice(1).some(row => row[5] === 'Waste'));
  assert.equal(base.Sheets['Daily SO'].rows[2][0], '2026-10-20', 'ITEM DATE is initialized with selected target date');

  const expectedSections = {
    ITEM: [{ id: id(1), type: 'material', name: 'Coffee Beans', unit: 'g' }],
    WIP: [{ id: id(3), type: 'wip', name: 'Cold Brew', unit: 'L' }],
    SUPPLIES: [{ id: id(2), type: 'supply', name: 'Glass Cloth', unit: 'pcs' }]
  };
  for (const [section, expected] of Object.entries(expectedSections)) {
    assert.deepEqual(mapRows(base, section).map(x => ({ id: x.id, type: x.type, name: x.name, unit: x.unit })), expected);
  }
  const wipRow = mapRows(base, 'WIP')[0].row;
  const supplyRow = mapRows(base, 'SUPPLIES')[0].row;
  assert.equal(base.Sheets['Daily SO'].rows[wipRow - 1][0] ?? '', '', 'WIP DATE column stays blank like the reference layout');
  assert.equal(base.Sheets['Daily SO'].rows[supplyRow - 1][0] ?? '', '', 'SUPPLIES DATE column stays blank like the reference layout');

  // Fill data in the single sheet: ITEM/WIP counts, item receipt, WIP production,
  // supplies receipt/count, and one row from the 25-line expense block.
  const valid = cloneWorkbook(base);
  for (const x of mapRows(valid, 'ITEM')) {
    setExcelCell(valid, 'Daily SO', x.row, 4, 5);
    setExcelCell(valid, 'Daily SO', x.row, 3, 2);
  }
  for (const x of mapRows(valid, 'WIP')) {
    setExcelCell(valid, 'Daily SO', x.row, 4, 3);
    setExcelCell(valid, 'Daily SO', x.row, 3, 20); // yield 10 per batch => 2 batches
  }
  for (const x of mapRows(valid, 'SUPPLIES')) {
    setExcelCell(valid, 'Daily SO', x.row, 4, 6);
    setExcelCell(valid, 'Daily SO', x.row, 3, 3);
  }
  setExcelCell(valid, 'Daily SO', 2, 6, 'Coffee Beans');
  setExcelCell(valid, 'Daily SO', 2, 7, 2);
  setExcelCell(valid, 'Daily SO', 2, 8, 'Waste');
  setExcelCell(valid, 'Daily SO', 2, 9, 'Rusak');
  const accepted = await preview(baseHarness, valid, 'daily-so.xlsx');
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.payload.daily_so.length, 2);
  assert.equal(accepted.payload.stock_in.length, 2);
  assert.equal(accepted.payload.production.length, 1);
  assert.equal(accepted.payload.production[0].batches, 2);
  assert.equal(accepted.payload.supplies.length, 1);
  assert.equal(accepted.payload.stock_out.length, 1);
  assert.equal(accepted.payload.stock_out[0].category, 'Waste');
  assert.equal(accepted.payload.stock_out[0].notes, 'Rusak');

  // Blank template and partial counts are not silently imported.
  const emptyHarness = createHarness();
  const emptyBook = await makeTemplate(emptyHarness);
  const empty = await preview(emptyHarness, emptyBook, 'empty.xlsx');
  assert(empty.errors.some(error => error.includes('Tidak ada data untuk diimpor')));
  const partialHarness = createHarness();
  const partialBook = await makeTemplate(partialHarness);
  const first = mapRows(partialBook, 'ITEM')[0];
  setExcelCell(partialBook, 'Daily SO', first.row, 4, 0);
  const partial = await preview(partialHarness, partialBook, 'partial.xlsx');
  assert(partial.errors.some(error => error.includes('isi AKHIR untuk semua ITEM dan WIP')));

  // Item or unit edits and target-date changes are rejected before database writes.
  const changedNameHarness = createHarness();
  const changedNameBook = await makeTemplate(changedNameHarness);
  setExcelCell(changedNameBook, 'Daily SO', mapRows(changedNameBook, 'ITEM')[0].row, 2, 'Renamed Coffee');
  const changedName = await preview(changedNameHarness, changedNameBook, 'changed-name.xlsx');
  assert(changedName.errors.some(error => error.includes('nama item berubah')));
  const wrongDateHarness = createHarness();
  const wrongDateBook = await makeTemplate(wrongDateHarness);
  wrongDateBook.Sheets._META.rows.find(row => row[0] === 'TARGET_DATE')[1] = '2026-10-19';
  const wrongDate = await preview(wrongDateHarness, wrongDateBook, 'wrong-date.xlsx');
  assert(wrongDate.errors.some(error => error.includes('tanggal closing terpilih')));

  // Move must provide an unambiguous destination division in the same outlet.
  const moveHarness = createHarness();
  const moveBook = await makeTemplate(moveHarness);
  setExcelCell(moveBook, 'Daily SO', 2, 6, 'Coffee Beans');
  setExcelCell(moveBook, 'Daily SO', 2, 7, 1);
  setExcelCell(moveBook, 'Daily SO', 2, 8, 'Move');
  setExcelCell(moveBook, 'Daily SO', 2, 9, 'Tujuan: Kitchen | ke dapur');
  const movePlan = await preview(moveHarness, moveBook, 'move.xlsx');
  assert.deepEqual(movePlan.errors, []);
  assert.equal(movePlan.payload.stock_out[0].target_division_id, TARGET_DIVISION_ID);
  assert.equal(movePlan.payload.stock_out[0].notes, 'ke dapur');

  const badMoveHarness = createHarness();
  const badMoveBook = await makeTemplate(badMoveHarness);
  setExcelCell(badMoveBook, 'Daily SO', 2, 6, 'Coffee Beans');
  setExcelCell(badMoveBook, 'Daily SO', 2, 7, 1);
  setExcelCell(badMoveBook, 'Daily SO', 2, 8, 'Move');
  setExcelCell(badMoveBook, 'Daily SO', 2, 9, 'pindah');
  const badMovePlan = await preview(badMoveHarness, badMoveBook, 'bad-move.xlsx');
  assert(badMovePlan.errors.some(error => error.includes('format "Tujuan: Nama Divisi')));

  // A pre-existing V2 workbook is routed through the legacy importer rather than rejected as V3.
  const legacyHarness = createHarness();
  const legacyBook = await makeTemplate(legacyHarness);
  legacyBook.Sheets._META.rows.find(row => row[0] === 'VERSION')[1] = 'BARAPP_CLOSING_TEMPLATE_V2';
  const legacyPlan = await preview(legacyHarness, legacyBook, 'legacy-v2.xlsx');
  assert(legacyPlan.errors.some(error => error.includes('Sheet Penjualan')),
    'V2 workbook should be routed to the legacy multi-sheet importer; errors='+JSON.stringify(legacyPlan.errors));

  // A workbook with validation errors cannot reach the atomic RPC.
  const submitHarness = createHarness({ allowRpc: true, rpcResult: { data: { summary: { daily_so: 2, stock_in: 2, stock_out: 1, production: 1, supplies: 1 } }, error: null } });
  const submitBook = await makeTemplate(submitHarness);
  for (const x of mapRows(submitBook, 'ITEM')) setExcelCell(submitBook, 'Daily SO', x.row, 4, 0);
  for (const x of mapRows(submitBook, 'WIP')) setExcelCell(submitBook, 'Daily SO', x.row, 4, 0);
  const submitPlan = await preview(submitHarness, submitBook, 'submit.xlsx');
  assert.deepEqual(submitPlan.errors, []);
  await submitHarness.api.clConfirmTemplateImport();
  assert.equal(submitHarness.rpcCalls.length, 1);
  assert.equal(submitHarness.rpcCalls[0].name, 'barapp_closing_import_template');
  assert.equal(submitHarness.rpcCalls[0].args.p_division_id, DIVISION_ID);
  assert.equal(submitHarness.rpcCalls[0].args.p_target_date, '2026-10-20');
  assert.equal(submitHarness.rpcCalls[0].args.p_template_id, submitPlan.templateId);
  assert.equal(submitHarness.rpcCalls[0].args.p_payload.daily_so.length, 2);
  assert.equal(submitHarness.CL.templateDraft, null);
  assert.equal(submitHarness.counters.loads, 1);

  const blockedHarness = createHarness({ allowRpc: true });
  const blockedBook = await makeTemplate(blockedHarness);
  setExcelCell(blockedBook, 'Daily SO', mapRows(blockedBook, 'ITEM')[0].row, 4, 0);
  await preview(blockedHarness, blockedBook, 'blocked.xlsx');
  await blockedHarness.api.clConfirmTemplateImport();
  assert.equal(blockedHarness.rpcCalls.length, 0);
  console.log('Approval Closing single-sheet Daily SO template: all tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
