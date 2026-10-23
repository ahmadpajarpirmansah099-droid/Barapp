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
    { id: id(1), division_id: DIVISION_ID, name: 'Coffee Beans', base_unit: 'g', active: true, is_supply: false, created_at: '2026-01-01', conversions: [{ unit: 'g', factor: 1 }, { unit: 'kg', factor: 1000 }] },
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
      this.validationRanges = [];
      this.dataValidations = {
        add: (address, rule) => {
          this.validationRanges.push({ address, rule: JSON.parse(JSON.stringify(rule)) });
          const match = /^([A-Z]+)([0-9]+):([A-Z]+)([0-9]+)$/.exec(address);
          if (!match || match[1] !== match[3]) throw new Error('Unsupported validation range in test harness: ' + address);
          let column = 0;
          for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
          for (let row = Number(match[2]); row <= Number(match[4]); row++) {
            this.getCell(row, column).dataValidation = rule;
          }
        }
      };
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
      while (this.rows.length < row) this.rows.push([]);
      while (this.rows[row - 1].length < column) this.rows[row - 1].push('');
      if (!this.cellMeta[key]) {
        const cell = {};
        Object.defineProperty(cell, 'value', {
          enumerable: true,
          get: () => this.rows[row - 1][column - 1],
          set: value => { this.rows[row - 1][column - 1] = value; }
        });
        this.cellMeta[key] = cell;
      }
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
              validationRanges: ws.validationRanges.map(entry => ({ address: entry.address, rule: JSON.parse(JSON.stringify(entry.rule)) })),
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

  // Requested default UNIT values are applied only when each unit is already
  // present in that item's conversion list; canonical metadata remains intact.
  const preferredDefinitions = [
    ['SKM', 'CAN'], ['SKM COKLAT', 'CAN'], ['GINGER ALE', 'CAN'], ['GINGGERALE', 'CAN'],
    ['GALON AQUA', 'GALON'], ['GALON VIT', 'GALON'], ['ES BATU ATLAS', 'BALL'],
    ['COCONUT WATER', 'BOTOL/PACK'], ['RON88', 'BOTOL/PACK']
  ];
  const preferredItems = preferredDefinitions.map(([name, unit], index) => ({
    id: id(20 + index), division_id: DIVISION_ID, name, base_unit: 'pcs',
    active: true, is_supply: false, created_at: '2026-01-01',
    conversions: [{ unit: 'pcs', factor: 1 }, { unit, factor: name === 'SKM' && unit === 'CAN' ? 488 : 1 }]
  }));
  const preferredHarness = createHarness({ items: preferredItems, wips: [], menus: [] });
  const preferredBook = await makeTemplate(preferredHarness);
  for (const [name, unit] of preferredDefinitions) {
    const row = mapRows(preferredBook, 'ITEM').find(x => x.name === name);
    assert(row, 'preferred item is in the template: ' + name);
    assert.equal(preferredBook.Sheets['Daily SO'].rows[row.row - 1][4], unit, name + ' has the requested default UNIT');
    assert.equal(row.unit, 'pcs', name + ' retains its canonical unit in metadata');
  }

  // Daily SO import converts the chosen counting unit to the Master Barang base unit.
  const preferredConversionBook = cloneWorkbook(preferredBook);
  const skmTemplateRow = mapRows(preferredConversionBook, 'ITEM').find(x => x.name === 'SKM');
  for (const x of mapRows(preferredConversionBook, 'ITEM')) {
    setExcelCell(preferredConversionBook, 'Daily SO', x.row, 4, x.name === 'SKM' ? 2 : 0);
  }
  const preferredConversionPlan = await preview(preferredHarness, preferredConversionBook, 'preferred-unit-conversion.xlsx');
  assert.deepEqual(preferredConversionPlan.errors, []);
  assert.equal(preferredConversionPlan.payload.daily_so.find(row => row.item_id === skmTemplateRow.id)?.qty, 976,
    '2 CAN SKM converts to 976 base units using the Master Barang factor of 488');

  // Do not prefill a preferred unit absent from an item conversion list.
  const missingUnitHarness = createHarness({
    items: [{
      id: id(40), division_id: DIVISION_ID, name: 'SKM', base_unit: 'pcs',
      active: true, is_supply: false, created_at: '2026-01-01',
      conversions: [{ unit: 'pcs', factor: 1 }]
    }],
    wips: [], menus: []
  });
  const missingUnitBook = await makeTemplate(missingUnitHarness);
  const missingUnitRow = mapRows(missingUnitBook, 'ITEM')[0];
  assert.equal(missingUnitBook.Sheets['Daily SO'].rows[missingUnitRow.row - 1][4], 'pcs',
    'missing preferred units safely fall back to the canonical unit');
  assert(missingUnitHarness.toastMessages.some(message => message.includes('SKM → CAN')),
    'the download warns when a requested default is absent from Master Barang');
  const visible = base.SheetNames.filter(name => !(base.Workbook.Sheets || []).some(sheet => sheet.name === name && sheet.Hidden === 1));
  assert.deepEqual(visible, ['Daily SO'], 'only the visual Daily SO template is visible');
  assert.equal(base.Workbook.Sheets.find(sheet => sheet.name === '_META')?.Hidden, 1);
  assert.equal(base.Workbook.Sheets.find(sheet => sheet.name === '_LISTS')?.Hidden, 1);
  assert.equal(base.Sheets._META.rows.find(row => row[0] === 'VERSION')?.[1], 'BARAPP_DAILY_SO_TEMPLATE_V4');
  assert.deepEqual(base.Sheets['Daily SO'].rows[0].slice(0, 10), [
    'DATE', 'ITEM', 'MASUK', 'AKHIR', 'UNIT', null,
    'ITEM', 'JUMLAH', 'KATEGORI', 'TUJUAN'
  ]);
  assert.equal(base.Sheets['Daily SO'].rows[1][1] ?? '', '');
  assert.equal(base.Sheets['Daily SO'].rows[1][6] ?? '', '');
  assert.equal(base.Sheets['Daily SO'].rows[25][6] ?? '', '');
  assert.equal(base.Sheets['Daily SO'].validations['2:7']?.type, 'list', 'expense ITEM dropdown exists in G');
  assert.equal(base.Sheets['Daily SO'].validations['2:9']?.type, 'list', 'expense KATEGORI dropdown exists in I');
  assert.equal(base.Sheets['Daily SO'].validations['26:7']?.type, 'list', 'ITEM dropdown covers row 25 of expenses');
  assert.equal(base.Sheets['Daily SO'].validations['26:9']?.type, 'list', 'category dropdown covers row 25 of expenses');
  assert.equal(base.Sheets['Daily SO'].validations['2:10']?.type, 'list', 'destination dropdown exists in J');
  assert.equal(base.Sheets['Daily SO'].validations['26:10']?.type, 'list', 'destination dropdown covers all expense rows');
  const dollar = String.fromCharCode(36);
  const itemFormula = '=' + dollar + 'L' + dollar + '2:' + dollar + 'L' + dollar + '3';
  const categoryFormula = '=' + dollar + 'K' + dollar + '2:' + dollar + 'K' + dollar + '7';
  const unitFormula = '=' + dollar + 'K' + dollar + '9:' + dollar + 'K' + dollar + '10';
  const targetFormula = '=' + dollar + 'P' + dollar + '2:' + dollar + 'P' + dollar + '2';
  assert.deepEqual(
    base.Sheets['Daily SO'].validationRanges.map(({ address, rule }) => ({ address, type: rule.type, formulae: rule.formulae })),
    [
      { address: 'E2:E3', type: 'list', formulae: [unitFormula] },
      { address: 'G2:G26', type: 'list', formulae: [itemFormula] },
      { address: 'I2:I26', type: 'list', formulae: [categoryFormula] },
      { address: 'J2:J26', type: 'list', formulae: [targetFormula] }
    ],
    'UNIT, ITEM, KATEGORI, and TUJUAN match the uploaded sample layout'
  );
  assert.deepEqual(base.Sheets['Daily SO'].validations['2:5']?.formulae, [unitFormula], 'UNIT dropdown covers the first item row');
  assert.deepEqual(base.Sheets['Daily SO'].validations['3:5']?.formulae, [unitFormula], 'UNIT dropdown covers the last item row');
  assert.deepEqual(base.Sheets['Daily SO'].validations['2:7']?.formulae, [itemFormula], 'ITEM dropdown is sourced from the same worksheet');
  assert.deepEqual(base.Sheets['Daily SO'].validations['2:9']?.formulae, [categoryFormula], 'KATEGORI dropdown is sourced from the same worksheet');
  const hiddenColumns = new Map(base.Sheets['Daily SO']['!cols'].map(col => [col.index, col.hidden]));
  [11, 12, 13, 14, 15, 16, 17].forEach(column => assert.equal(hiddenColumns.get(column), true, 'dropdown helper column ' + column + ' is hidden'));
  [13, 14, 15, 16, 17].forEach(column => assert.equal(hiddenColumns.get(column), true, 'metadata helper column ' + column + ' stays hidden'));
  assert.equal(base.Sheets['Daily SO'].rows[1][10], 'Move', 'category list begins at K2 from Pengeluaran');
  assert.equal(base.Sheets['Daily SO'].rows[6][10], 'Lainnya', 'category list follows Pengeluaran order');
  assert.equal(base.Sheets['Daily SO'].rows[8][10], 'g', 'unit options begin at K9');
  assert.equal(base.Sheets['Daily SO'].rows[9][10], 'kg', 'all valid master units are included');
  assert.equal(base.Sheets['Daily SO'].rows[1][11], 'Coffee Beans', 'expense item options are visible in column L');
  assert.equal(base.Sheets['Daily SO'].rows[1][12], id(1), 'hidden same-sheet helper preserves the item ID');
  assert.equal(base.Sheets['Daily SO'].rows[1][15], 'Kitchen', 'target division dropdown options are in column P');
  assert.equal(base.Sheets['Daily SO'].rows[1][16], TARGET_DIVISION_ID, 'hidden same-sheet helper preserves the target division ID');
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
  assert.equal(base.Sheets['Daily SO'].rows[wipRow - 1][0], '2026-10-20', 'WIP DATE is initialized with selected target date');
  assert.equal(base.Sheets['Daily SO'].rows[supplyRow - 1][0], '2026-10-20', 'SUPPLIES DATE is initialized with selected target date');

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
  setExcelCell(valid, 'Daily SO', 2, 7, 'Coffee Beans');
  setExcelCell(valid, 'Daily SO', 2, 8, 2);
  setExcelCell(valid, 'Daily SO', 2, 9, 'Waste');
  setExcelCell(valid, 'Daily SO', mapRows(valid, 'ITEM')[0].row, 5, 'kg');
  const accepted = await preview(baseHarness, valid, 'daily-so.xlsx');
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.payload.daily_so.length, 2);
  assert.equal(accepted.payload.stock_in.length, 2);
  assert.equal(accepted.payload.production.length, 1);
  assert.equal(accepted.payload.production[0].batches, 2);
  assert.equal(accepted.payload.supplies.length, 1);
  assert.equal(accepted.payload.stock_out.length, 1);
  assert.equal(accepted.payload.stock_out[0].category, 'Waste');
  assert.equal(accepted.payload.stock_out[0].notes, '');
  assert.equal(accepted.payload.stock_in.find(row => row.item_id === id(1))?.unit, 'kg', 'MASUK uses the selected unit from the row');
  assert.equal(accepted.payload.daily_so.find(row => row.item_id === id(1))?.qty, 5000, 'AKHIR converts 5 kg to 5000 g using that item conversion');

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

  // The previous V3 layout is retired; only the current template is accepted.
  const oldTemplateHarness = createHarness();
  const oldTemplateBook = await makeTemplate(oldTemplateHarness);
  oldTemplateBook.Sheets._META.rows.find(row => row[0] === 'VERSION')[1] = 'BARAPP_DAILY_SO_TEMPLATE_V3';
  const oldTemplatePlan = await preview(oldTemplateHarness, oldTemplateBook, 'old-template-v3.xlsx');
  assert(oldTemplatePlan.errors.some(error => error.includes('Template lama tidak didukung')),
    'old V3 template must be rejected so download/upload use one current format');

  // Move must provide an unambiguous destination division in the same outlet.
  const moveHarness = createHarness();
  const moveBook = await makeTemplate(moveHarness);
  setExcelCell(moveBook, 'Daily SO', 2, 7, 'Coffee Beans');
  setExcelCell(moveBook, 'Daily SO', 2, 8, 1);
  setExcelCell(moveBook, 'Daily SO', 2, 9, 'Move');
  setExcelCell(moveBook, 'Daily SO', 2, 10, 'Kitchen');
  const movePlan = await preview(moveHarness, moveBook, 'move.xlsx');
  assert.deepEqual(movePlan.errors, []);
  assert.equal(movePlan.payload.stock_out[0].target_division_id, TARGET_DIVISION_ID);
  assert.equal(movePlan.payload.stock_out[0].notes, '');

  const badMoveHarness = createHarness();
  const badMoveBook = await makeTemplate(badMoveHarness);
  setExcelCell(badMoveBook, 'Daily SO', 2, 7, 'Coffee Beans');
  setExcelCell(badMoveBook, 'Daily SO', 2, 8, 1);
  setExcelCell(badMoveBook, 'Daily SO', 2, 9, 'Move');
  setExcelCell(badMoveBook, 'Daily SO', 2, 10, '');
  const badMovePlan = await preview(badMoveHarness, badMoveBook, 'bad-move.xlsx');
  assert(badMovePlan.errors.some(error => error.includes('TUJUAN wajib dipilih')));

  const invalidUnitHarness = createHarness();
  const invalidUnitBook = await makeTemplate(invalidUnitHarness);
  const invalidUnitItem = mapRows(invalidUnitBook, 'ITEM')[0];
  setExcelCell(invalidUnitBook, 'Daily SO', invalidUnitItem.row, 4, 1);
  setExcelCell(invalidUnitBook, 'Daily SO', invalidUnitItem.row, 5, 'LITER');
  const invalidUnitPlan = await preview(invalidUnitHarness, invalidUnitBook, 'invalid-unit.xlsx');
  assert(invalidUnitPlan.errors.some(error => error.includes('satuan "LITER" tidak tersedia di Master Barang untuk item ini')), 'a global unit option cannot bypass per-item master conversion validation');

  // The old multi-sheet V2 format is retired; only the current layout remains accepted.
  const legacyHarness = createHarness();
  const legacyBook = await makeTemplate(legacyHarness);
  legacyBook.Sheets._META.rows.find(row => row[0] === 'VERSION')[1] = 'BARAPP_CLOSING_TEMPLATE_V2';
  const legacyPlan = await preview(legacyHarness, legacyBook, 'legacy-v2.xlsx');
  assert(legacyPlan.errors.some(error => error.includes('Template lama tidak didukung')),
    'V2 workbook must be rejected instead of routed to the retired importer');

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
