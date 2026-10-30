'use strict';
// Local contract tests for Apps Script. Google services are stubbed; no Google data is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../google-apps-script/Code.gs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../google-apps-script/appsscript.json'), 'utf8'));
const SECRET = 'test-secret-never-used-in-production-1234567890';
const SHEET_ID = 'private-test-spreadsheet-id';
const VERSION = '2026-10-27-ieee-ies-day-email-1';
const HEADERS = ['Submitted At', 'Full name', 'Email', 'University', 'Faculty / Department', 'WhatsApp', 'Request ID'];
const PREVIOUS_HEADERS = ['Submitted At', 'Full name', 'University', 'Faculty / Department', 'WhatsApp', 'Request ID'];
const STANDARD = {
  secret: SECRET, requestId: 'f6b279d8-6226-49f4-8d60-d01f5d94a601',
  firstName: 'Example', email: 'example@example.com', university: 'University of Kelaniya', faculty: 'Faculty of Science',
  whatsapp: '0712345678'
};
const displayed = value => typeof value === 'string' && value.startsWith("'") ? value.slice(1) : String(value ?? '');
function harness(options = {}) {
  const calls = [];
  const settings = options.settings === undefined ? { REGISTRATION_SECRET: SECRET, SPREADSHEET_ID: SHEET_ID } : { ...options.settings };
  const sheet = {
    rows: (options.rows || [HEADERS]).map(row => [...row]),
    maxRows: options.maxRows || 1000, maxColumns: options.maxColumns || 26,
    filter: options.filter || null,
    getLastColumn() { return this.rows.reduce((max, row) => Math.max(max, row.reduce((n, cell, i) => cell === '' || cell == null ? n : i + 1, 0)), 0); },
    getLastRow() { return this.rows.reduce((last, row, i) => row.some(cell => cell !== '' && cell != null) ? i + 1 : last, 0); },
    getMaxRows() { return this.maxRows; },
    getMaxColumns() { return this.maxColumns; },
    getRange(row, col, height = 1, width = 1) {
      assert.ok(row >= 1 && col >= 1 && height >= 1 && width >= 1);
      assert.ok(row + height - 1 <= this.maxRows, 'range exceeds allocated rows');
      assert.ok(col + width - 1 <= this.maxColumns, 'range exceeds allocated columns');
      const range = {
        getDisplayValues() {
          calls.push(['read', row, col, height, width]);
          return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => displayed(sheet.rows[row + r - 1]?.[col + c - 1])));
        },
        setValues(values) {
          assert.equal(values.length, height);
          assert.ok(values.every(value => value.length === width));
          calls.push(['write', row, col, height, width]);
          if (options.failWrite) throw options.writeError || Error('private-storage-error');
          values.forEach((cells, r) => {
            sheet.rows[row + r - 1] ||= [];
            cells.forEach((value, c) => { sheet.rows[row + r - 1][col + c - 1] = value; });
          });
          return this;
        },
        setValue(value) { return this.setValues([[value]]); },
        setNumberFormat(format) { calls.push(['format', row, col, height, width, format]); return this; },
        setBackground(value) { calls.push(['style', 'background', value]); return this; },
        setFontColor(value) { calls.push(['style', 'color', value]); return this; },
        setFontWeight(value) { calls.push(['style', 'weight', value]); return this; },
        setWrap(value) { calls.push(['style', 'wrap', value]); return this; },
        createFilter() { calls.push(['filter']); sheet.filter = {}; return sheet.filter; },
        copyFormatToRange(target, startCol, endCol, startRow, endRow) {
          assert.equal(target, sheet);
          calls.push(['copy-format', startCol, endCol, startRow, endRow]);
        },
        createTextFinder(search) {
          const config = {};
          return {
            matchEntireCell(value) { config.exact = value; return this; },
            matchCase(value) { config.case = value; return this; },
            useRegularExpression(value) { config.regex = value; return this; },
            findNext() {
              assert.equal(config.exact, true);
              assert.equal(config.regex, false);
              calls.push(['find', col, search, config.case]);
              if (options.failFindColumn === col) throw options.findError || Error('private-finder-error');
              for (let r = row; r < row + height; r++) {
                const value = displayed(sheet.rows[r - 1]?.[col - 1]);
                if ((config.case ? value : value.toLowerCase()) === (config.case ? search : search.toLowerCase())) return { getRow: () => r };
              }
              return null;
            }
          };
        }
      };
      return range;
    },
    insertColumnsAfter(after, count) { calls.push(['grow-columns', after, count]); this.maxColumns += count; },
    insertRowsAfter(after, count) { calls.push(['grow-rows', after, count]); this.maxRows += count; },
    setFrozenRows(value) { calls.push(['freeze', value]); },
    setColumnWidth(col, width) { calls.push(['width', col, 1, width]); },
    setColumnWidths(col, count, width) { calls.push(['width', col, count, width]); },
    getFilter() { return this.filter; }
  };
  const spreadsheet = {
    getId: () => SHEET_ID,
    getSheetByName(name) { assert.equal(name, 'Registrations'); return options.missingSheet ? null : sheet; },
    insertSheet(name) { assert.equal(name, 'Registrations'); calls.push(['create-sheet']); sheet.rows = []; options.missingSheet = false; return sheet; },
    setSpreadsheetTimeZone(zone) { calls.push(['timezone', zone]); }
  };
  const lock = {
    tryLock(ms) { calls.push(['lock', ms]); if (options.onLock) options.onLock(settings); return !options.busy; },
    releaseLock() { calls.push(['release']); if (options.failRelease) throw Error('release failed'); }
  };
  let uuidCount = 0;
  const properties = {
    getProperty: key => settings[key] ?? null,
    getProperties: () => ({ ...settings }),
    setProperties(values) { calls.push(['properties']); Object.assign(settings, values); }
  };
  const context = vm.createContext({
    console: { info: (...values) => calls.push(['log', ...values]), error: (...values) => calls.push(['error-log', ...values]) },
    PropertiesService: { getScriptProperties: () => properties },
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: {
      getActiveSpreadsheet() { calls.push(['active']); if (options.noActive) return null; return spreadsheet; },
      openById(id) { calls.push(['open', id]); assert.equal(id, settings.SPREADSHEET_ID); if (options.failOpen) throw options.openError || Error('private-id-' + id); return spreadsheet; },
      flush() { calls.push(['flush']); if (options.failFlush) throw options.flushError || Error('flush failed'); }
    },
    Utilities: {
      newBlob: value => ({ getBytes: () => [...Buffer.from(value, 'utf8')] }),
      getUuid: () => { uuidCount++; return uuidCount % 2 ? '12345678-1234-1234-1234-123456789012' : 'abcdefab-abcd-abcd-abcd-abcdefabcdef'; }
    }
  });
  vm.runInContext(source, context, { filename: 'Code.gs' });
  return {
    calls, settings, sheet, context,
    post(data = STANDARD) { return this.raw(JSON.stringify(data)); },
    raw(body) { const response = context.doPost({ postData: { contents: body } }); assert.equal(response.mime, 'application/json'); return JSON.parse(response.text); },
    setup: () => JSON.parse(JSON.stringify(context.setupRegistrationSheet())),
    diagnose: () => JSON.parse(JSON.stringify(context.diagnoseRegistrationStorage())),
    get: () => JSON.parse(context.doGet().text),
    uuidCount: () => uuidCount,
    reset() { calls.length = 0; }
  };
}
// The ContentService stub is attached separately to keep response behavior visible.
const originalHarness = harness;
function create(options) {
  const h = originalHarness(options);
  h.context.ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: text => ({ text, setMimeType(mime) { this.mime = mime; return this; } })
  };
  return h;
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }
const mutations = calls => calls.filter(call => ['write', 'grow-rows', 'grow-columns', 'create-sheet', 'properties'].includes(call[0]));

test('manifest uses V8, Colombo time and only the spreadsheet OAuth scope', () => {
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.timeZone, 'Asia/Colombo');
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets']);
});
test('health check exposes no private configuration and opens no spreadsheet', () => {
  const h = create();
  assert.deepEqual(h.get(), { success: true, code: 'OK', service: 'IEEE IES Day registration', version: VERSION });
  assert.equal(h.calls.length, 0);
});
test('malformed bodies and oversized ASCII/UTF-8 bodies are rejected before storage', () => {
  const h = create();
  for (const body of ['', '{', 'null', '[]', 'false', '42']) assert.equal(h.raw(body).code, 'INVALID');
  assert.equal(h.raw('x'.repeat(8193)).code, 'PAYLOAD_TOO_LARGE');
  assert.equal(h.raw(JSON.stringify({ ...STANDARD, firstName: '雪'.repeat(2900) })).code, 'PAYLOAD_TOO_LARGE');
  assert.equal(h.calls.length, 0);
});
test('unauthorized requests and invalid configuration never acquire a lock or open Sheets', () => {
  for (const secret of [undefined, '', 'wrong-secret', SECRET.slice(0, -1) + 'x', 1, {}]) {
    const h = create();
    assert.equal(h.post({ ...STANDARD, secret }).code, 'UNAUTHORIZED');
    assert.equal(h.calls.length, 0);
  }
  for (const settings of [{}, { REGISTRATION_SECRET: 'too-short' }, { REGISTRATION_SECRET: SECRET }]) {
    const h = create({ settings });
    assert.equal(h.post().code, 'NOT_CONFIGURED');
    assert.equal(h.calls.length, 0);
  }
});
test('payload rejects wrong types, unknown fields, honeypots and invalid registration details before storage', () => {
  const invalid = [
    { firstName: ['Example'] }, { firstName: 'A' }, { firstName: 'a'.repeat(81) }, { firstName: 'Eve\nName' },
    { email: undefined },
    { email: '' }, { email: 'not-an-email' }, { email: 'name@example' }, { email: 'a'.repeat(250) + '@x.com' },
    { university: '' }, { university: 123 }, { university: 'U'.repeat(121) },
    { faculty: ' ' }, { faculty: 23 }, { faculty: 'F'.repeat(121) }, { whatsapp: 'not-a-phone' },
    { requestId: 'short' }, { requestId: '=malicious-id' },
    { website: 'bot.example' }, { website: {} }, { extra: 'value' }, { studentId: 'SC/2026/999' }
  ];
  for (const override of invalid) {
    const h = create();
    assert.equal(h.post({ ...STANDARD, ...override }).code, 'INVALID', JSON.stringify(override));
    assert.equal(h.calls.length, 0);
  }
});
test('normal registration uses openById, a small header read and one flushed row write', () => {
  const h = create();
  assert.deepEqual(h.post(), { success: true, code: 'OK' });
  assert.deepEqual(h.calls.filter(call => call[0] === 'open'), [['open', SHEET_ID]]);
  assert.deepEqual(h.calls.filter(call => call[0] === 'read'), [['read', 1, 1, 1, 7]]);
  assert.deepEqual(h.calls.filter(call => call[0] === 'write'), [['write', 2, 1, 1, 7]]);
  assert.ok(!h.calls.some(call => ['active', 'format', 'style', 'copy-format'].includes(call[0])));
  assert.ok(h.calls.findIndex(call => call[0] === 'flush') < h.calls.findIndex(call => call[0] === 'release'));
  assert.equal(h.sheet.rows[1][5], "'0712345678");
  assert.equal(h.sheet.rows[1][2], STANDARD.email);
  assert.equal(h.sheet.rows[1][6], "'" + STANDARD.requestId);
});
test('formula-like user data and exact phone strings are stored as literals', () => {
  const h = create();
  const data = { ...STANDARD, firstName: '=HYPERLINK("https://example.com")', university: '=IMPORTXML("x")', whatsapp: '+94712345678' };
  assert.equal(h.post(data).success, true);
  const row = h.sheet.rows[1];
  assert.equal(row[1], "'=HYPERLINK(\"https://example.com\")");
  assert.equal(row[3], "'=IMPORTXML(\"x\")");
  assert.equal(row[5], "'+94712345678");
  assert.equal(row[6], "'" + STANDARD.requestId);
  for (const prefix of ['+', '-', '@', "'"]) {
    assert.equal(h.context.cleanCell_(prefix + 'Example'), "'" + prefix + 'Example');
  }
});
test('same request ID returns idempotent success without another write', () => {
  const h = create();
  assert.equal(h.post().code, 'OK');
  h.reset();
  assert.deepEqual(h.post(), { success: true, code: 'ALREADY_STORED', alreadyStored: true });
  assert.equal(mutations(h.calls).length, 0);
  assert.deepEqual(h.calls.filter(call => call[0] === 'find'), [['find', 7, STANDARD.requestId, true]]);
});
test('blank, missing, malformed university and faculty names are rejected before accessing Sheets', () => {
  for (const university of ['', '   ', undefined, null, 123, {}, [], 'U'.repeat(121)]) {
    const h = create();
    assert.deepEqual(h.post({ ...STANDARD, university }), { success: false, code: 'INVALID' });
    assert.equal(h.calls.length, 0);
  }
  for (const faculty of ['', '   ', 123, 'F'.repeat(121)]) {
    const h = create();
    assert.deepEqual(h.post({ ...STANDARD, faculty }), { success: false, code: 'INVALID' });
    assert.equal(h.calls.length, 0);
  }
  assert.deepEqual(create().post({ ...STANDARD, university: 'Example University', faculty: 'Engineering' }), { success: true, code: 'OK' });
});
test('POST never modifies mismatched legacy headers or a missing tab', () => {
  for (const rows of [[['Do not overwrite']], [PREVIOUS_HEADERS], [HEADERS.slice(0, 5)], [[...HEADERS, 'Private extra column']], [[...HEADERS.slice(0, 5), 'Wrong request header']]]) {
    const h = create({ rows });
    assert.equal(h.post().code, 'SCHEMA_MISMATCH');
    assert.equal(mutations(h.calls).length, 0);
    assert.ok(h.calls.some(call => call[0] === 'release'));
  }
  const missing = create({ missingSheet: true });
  assert.equal(missing.post().code, 'NOT_CONFIGURED');
  assert.equal(mutations(missing.calls).length, 0);
});
test('busy and storage errors return stable codes without leaking service details', () => {
  const busy = create({ busy: true });
  assert.equal(busy.post().code, 'BUSY');
  assert.ok(!busy.calls.some(call => call[0] === 'open' || call[0] === 'release'));
  for (const failure of ['failOpen', 'failWrite', 'failFlush']) {
    const h = create({ [failure]: true });
    const response = h.post();
    assert.deepEqual(response, { success: false, code: 'STORAGE_UNAVAILABLE' });
    assert.ok(h.calls.some(call => call[0] === 'release'));
    assert.ok(!JSON.stringify(response).includes(SHEET_ID));
    assert.ok(!JSON.stringify(h.calls.filter(call => call[0] === 'error-log')).includes(SHEET_ID));
  }
  assert.equal(create({ failRelease: true }).post().code, 'OK');
});
test('capacity grows in a batch only when needed and copies existing row formats', () => {
  const existing = ['', 'Existing', 'existing@example.com', '', '', '', 'different-request-id'];
  const h = create({ rows: [HEADERS, existing], maxRows: 2 });
  assert.equal(h.post().code, 'OK');
  assert.deepEqual(h.calls.filter(call => call[0] === 'grow-rows'), [['grow-rows', 2, 500]]);
  assert.deepEqual(h.calls.filter(call => call[0] === 'copy-format'), [['copy-format', 1, 7, 3, 502]]);
  assert.deepEqual(h.calls.filter(call => call[0] === 'write'), [['write', 3, 1, 1, 7]]);
});
test('setup creates the tab, stores spreadsheet ID, generates a secret and formats once', () => {
  const h = create({ missingSheet: true, rows: [], maxRows: 10, maxColumns: 5, settings: {} });
  assert.deepEqual(h.setup(), { success: true, code: 'READY' });
  assert.deepEqual(h.sheet.rows[0], HEADERS);
  assert.equal(h.settings.SPREADSHEET_ID, SHEET_ID);
  assert.equal(h.settings.REGISTRATION_SECRET.length, 64);
  assert.equal(h.uuidCount(), 2);
  assert.equal(h.sheet.maxRows, 1000);
  assert.equal(h.sheet.maxColumns, 7);
  assert.deepEqual(h.calls.filter(call => call[0] === 'format'), [
    ['format', 2, 1, 999, 1, 'yyyy-mm-dd hh:mm:ss'], ['format', 2, 2, 999, 6, '@']
  ]);
  assert.ok(h.calls.some(call => call[0] === 'freeze' && call[1] === 1));
  assert.ok(h.calls.some(call => call[0] === 'timezone' && call[1] === 'Asia/Colombo'));
  assert.ok(h.calls.some(call => call[0] === 'filter'));
  assert.ok(!JSON.stringify(h.calls.filter(call => call[0] === 'log')).includes(h.settings.REGISTRATION_SECRET));
});
test('setup reuses existing secret and filter without rewriting compatible headers or records', () => {
  const existing = ['', 'Existing', 'existing@example.com', 'University', 'Engineering', '0711111111', 'existing-request'];
  const h = create({ rows: [HEADERS, existing], filter: {} });
  const before = JSON.stringify(h.sheet.rows);
  assert.equal(h.setup().code, 'READY');
  assert.equal(h.settings.REGISTRATION_SECRET, SECRET);
  assert.equal(h.uuidCount(), 0);
  assert.equal(JSON.stringify(h.sheet.rows), before);
  assert.ok(!h.calls.some(call => call[0] === 'write' || call[0] === 'filter'));
});
test('setup refuses the old Carols schema without changing archived records', () => {
  const legacyHeaders = ['Submitted At', 'Full name', 'Student ID', 'Faculty', 'WhatsApp', 'Singing', 'Instruments', 'Support Preferences', 'Thursday 5PM Rehearsals', 'Request ID'];
  const legacyRows = [legacyHeaders, ['', 'Existing registration', 'SC/2026/111', 'Faculty of Science', '0711111111', 'Yes', '', '', 'Yes', 'old-request']];
  const h = create({ rows: legacyRows, maxColumns: 10 });
  const before = JSON.stringify(h.sheet.rows);
  assert.equal(h.setup().code, 'SCHEMA_MISMATCH');
  assert.equal(JSON.stringify(h.sheet.rows), before);
  assert.equal(mutations(h.calls).length, 0);
});
test('setup refuses missing context/weak existing secret, preserves concurrent configuration, and reports errors', () => {
  const inactive = create({ noActive: true });
  assert.equal(inactive.setup().code, 'NOT_CONFIGURED');
  assert.equal(mutations(inactive.calls).length, 0);
  const weak = create({ settings: { REGISTRATION_SECRET: 'short' } });
  assert.equal(weak.setup().code, 'NOT_CONFIGURED');
  assert.equal(weak.settings.REGISTRATION_SECRET, 'short');
  assert.equal(mutations(weak.calls).length, 0);
  const concurrent = create({ settings: {}, onLock: settings => { settings.REGISTRATION_SECRET = SECRET; } });
  assert.equal(concurrent.setup().code, 'READY');
  assert.equal(concurrent.settings.REGISTRATION_SECRET, SECRET);
  assert.equal(concurrent.uuidCount(), 0);
  const busy = create({ busy: true });
  assert.equal(busy.setup().code, 'BUSY');
  const failure = create({ failFlush: true });
  assert.equal(failure.setup().code, 'STORAGE_UNAVAILABLE');
  assert.ok(failure.calls.some(call => call[0] === 'release'));
});
test('failure categories recognize known Google service messages without exposing their text', () => {
  const h = create();
  const categories = [
    ['Limit exceeded: Spreadsheet quota for ' + SHEET_ID, 'quota'],
    ['Service invoked too many times: Spreadsheets', 'quota'],
    ['Service using too much computer time for one day', 'quota'],
    ['Service invoked too many times in a short time: Spreadsheets', 'rate-limit'],
    ['Script invoked too many times per second', 'rate-limit'],
    ['There are too many scripts running simultaneously', 'rate-limit'],
    ['You do not have permission to access document ' + SHEET_ID, 'permission'],
    ['Authorization is required to perform that action', 'permission'],
    ['Service Spreadsheets failed while accessing document with id ' + SHEET_ID, 'document-unavailable'],
    ['Document ' + SHEET_ID + ' is missing', 'document-unavailable'],
    ['Service error: Spreadsheets ' + SECRET, 'service-error'],
    ['The operation timed out', 'service-error'],
    ['Unexpected private data: Example 0712345678 ' + SECRET, 'unknown']
  ];
  for (const [message, expected] of categories) {
    assert.equal(h.context.failureCategory_(new Error(message)), expected, message);
  }
  assert.equal(h.context.failureCategory_(null), 'unknown');
  assert.equal(h.context.exceptionType_(new TypeError('private')), 'TypeError');
  assert.equal(h.context.exceptionType_({ name: 'Exception' }), 'Exception');
  assert.equal(h.context.exceptionType_({ name: SECRET }), 'Error');
  assert.equal(h.calls.length, 0);
});
test('storage logs record a fixed phase/category/type and exclude private errors, payloads and stacks', () => {
  const existing = ['', 'Private existing person', 'private@example.com', 'University', 'Engineering', '0711111111', 'existing-request-id'];
  const sensitive = `${SHEET_ID} ${SECRET} Example ${STANDARD.email} SC/2026/999 0712345678 ${STANDARD.requestId}`;
  const failures = [
    [{ failOpen: true, openError: new Error('Service Spreadsheets failed while accessing document with id ' + sensitive) }, 'open-spreadsheet', 'document-unavailable', 'Error'],
    [{ failFindColumn: 7, findError: new TypeError('Service error: Spreadsheets ' + sensitive) }, 'request-id-lookup', 'service-error', 'TypeError'],
    [{ failWrite: true, writeError: Object.assign(new Error('Permission denied ' + sensitive), { name: 'Private-Name-' + sensitive }) }, 'write-registration', 'permission', 'Error'],
    [{ failFlush: true, flushError: new Error('Quota exceeded for ' + sensitive) }, 'flush', 'quota', 'Error']
  ];
  for (const [options, phase, category, exceptionType] of failures) {
    const h = create({ ...options, rows: [HEADERS, existing] });
    assert.deepEqual(h.post(), { success: false, code: 'STORAGE_UNAVAILABLE' });
    const errors = h.calls.filter(call => call[0] === 'error-log');
    assert.equal(errors.length, 1);
    assert.deepEqual(JSON.parse(errors[0][1]), {
      event: 'registration_storage_failure', version: VERSION, operation: 'register', phase, category, exceptionType
    });
    const log = JSON.stringify(errors);
    for (const privateValue of [SHEET_ID, SECRET, 'Example', STANDARD.email, 'University', '0712345678', STANDARD.requestId, 'Private-Name-']) {
      assert.ok(!log.includes(privateValue), 'private value appeared in log: ' + privateValue);
    }
    assert.ok(!log.includes('stack') && !log.includes('message'));
    assert.ok(h.calls.some(call => call[0] === 'release'));
    assert.ok(!h.calls.some(call => call[0] === 'format' || call[0] === 'style'));
  }
});
test('owner diagnostics report safe configuration/schema/counts and perform only reads', () => {
  const existing = ['', 'Private existing person', 'private@example.com', 'University', 'Engineering', '0711111111', 'existing-request-id'];
  const h = create({ rows: [HEADERS, existing] });
  const before = JSON.stringify({ settings: h.settings, rows: h.sheet.rows });
  const report = h.diagnose();
  assert.deepEqual(report, {
    version: VERSION, code: 'READY', secretConfigured: true, spreadsheetConfigured: true,
    accessVerified: true, sheetExists: true, schemaOkay: true, headerCount: 7, registrationCount: 1
  });
  assert.equal(JSON.stringify({ settings: h.settings, rows: h.sheet.rows }), before);
  assert.ok(h.calls.every(call => ['open', 'read', 'log'].includes(call[0])));
  assert.deepEqual(h.calls.filter(call => call[0] === 'read'), [['read', 1, 1, 1, 7]]);
  const logged = JSON.parse(h.calls.find(call => call[0] === 'log')[1]);
  assert.deepEqual(logged, { event: 'registration_storage_diagnostic', ...report });
  const safeOutput = JSON.stringify([report, logged]);
  for (const privateValue of [SHEET_ID, SECRET, 'Private existing person', 'University', '0711111111', 'existing-request-id']) {
    assert.ok(!safeOutput.includes(privateValue));
  }
  assert.equal(h.uuidCount(), 0);
});
test('owner diagnostics never repair missing or misaligned sheets/configuration', () => {
  const cases = [
    [{ settings: {} }, 'NOT_CONFIGURED', false, false],
    [{ settings: { SPREADSHEET_ID: SHEET_ID } }, 'NOT_CONFIGURED', true, true],
    [{ missingSheet: true }, 'NOT_CONFIGURED', true, false],
    [{ rows: [['Private unrelated header'], ['Private unrelated record']] }, 'SCHEMA_MISMATCH', true, true],
    [{ rows: [PREVIOUS_HEADERS] }, 'SCHEMA_MISMATCH', true, true],
    [{ rows: [HEADERS.slice(0, 6)] }, 'SCHEMA_MISMATCH', true, true]
  ];
  for (const [options, code, accessVerified, sheetExists] of cases) {
    const h = create(options);
    const before = JSON.stringify({ settings: h.settings, rows: h.sheet.rows });
    const report = h.diagnose();
    assert.equal(report.code, code);
    assert.equal(report.accessVerified, accessVerified);
    assert.equal(report.sheetExists, sheetExists);
    assert.equal(JSON.stringify({ settings: h.settings, rows: h.sheet.rows }), before);
    assert.ok(h.calls.every(call => ['open', 'read', 'log'].includes(call[0])));
    assert.equal(h.uuidCount(), 0);
  }
});
test('owner diagnostics sanitize access failures and setup errors preserve phase logging', () => {
  const privateError = new Error('Service Spreadsheets failed while accessing document with id ' + SHEET_ID + ' ' + SECRET);
  const h = create({ failOpen: true, openError: privateError });
  const report = h.diagnose();
  assert.equal(report.code, 'STORAGE_UNAVAILABLE');
  assert.equal(report.failureCategory, 'document-unavailable');
  assert.equal(report.exceptionType, 'Error');
  assert.ok(h.calls.every(call => ['open', 'error-log', 'log'].includes(call[0])));
  const logs = JSON.stringify(h.calls.filter(call => ['log', 'error-log'].includes(call[0])));
  assert.ok(!logs.includes(SHEET_ID) && !logs.includes(SECRET));
  const setup = create({ failFlush: true, flushError: new Error('Service error: ' + SECRET) });
  assert.equal(setup.setup().code, 'STORAGE_UNAVAILABLE');
  const failure = JSON.parse(setup.calls.find(call => call[0] === 'error-log')[1]);
  assert.equal(failure.operation, 'setup');
  assert.equal(failure.phase, 'flush');
  assert.equal(failure.category, 'service-error');
  assert.ok(!JSON.stringify(failure).includes(SECRET));
});
async function testApiBridge() {
  const { handler: registerHandler } = require('../netlify/functions/register.js');
  const previousFetch = global.fetch;
  const previousUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  const previousSecret = process.env.REGISTRATION_SECRET;
  const h = create();
  process.env.GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test-deployment/exec';
  process.env.REGISTRATION_SECRET = SECRET;
  let loseFirstResponse = true;
  const attempts = [];
  global.fetch = async (url, options) => {
    assert.equal(url, process.env.GOOGLE_APPS_SCRIPT_URL);
    const payload = JSON.parse(options.body);
    assert.equal(payload.secret, SECRET);
    assert.equal(payload.email, STANDARD.email);
    assert.equal(payload.university, STANDARD.university);
    attempts.push(options.body);
    const result = h.raw(options.body);
    return { ok: true, status: 200, json: async () => result };
  };
  async function submit(override = {}) {
    const browserPayload = { ...STANDARD, ...override };
    delete browserPayload.secret;
    const response = { setHeader() { }, end(body) { this.body = JSON.parse(body); } };
    const res = await registerHandler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(browserPayload) }); response.statusCode = res.statusCode; response.body = JSON.parse(res.body);
    return response;
  }
  try {
    const first = await submit({ whatsapp: '071 234 5678' });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.body, { success: true });
    
    assert.equal(h.sheet.rows[1][5], "'0712345678");
    const retry = await submit();
    assert.equal(retry.statusCode, 200);
    assert.equal(h.sheet.rows.length, 2);
    // Duplicate phone with a different request ID must be rejected
    const duplicatePhone = await submit({ requestId: 'a-new-request-id', whatsapp: '071 234 5678' });
    assert.equal(duplicatePhone.statusCode, 409);
    assert.equal(duplicatePhone.body.error, 'You have already registered to the event with this phone number.');

    // Different phone number with new request ID must succeed
    const secondRegistration = await submit({ requestId: 'a-new-request-id', whatsapp: '077 765 4321' });
    assert.equal(secondRegistration.statusCode, 200);
    assert.equal(h.sheet.rows.length, 3);
    assert.equal(h.calls.filter(call => call[0] === 'write').length, 2);
    assert.ok(!h.calls.some(call => call[0] === 'format' || call[0] === 'style'));
    passed++;
    console.log('✓ Netlify API -> Apps Script VM bridge safely retries after a committed write and accepts multiple registrations from the same university');
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.GOOGLE_APPS_SCRIPT_URL;
    else process.env.GOOGLE_APPS_SCRIPT_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.REGISTRATION_SECRET;
    else process.env.REGISTRATION_SECRET = previousSecret;
  }
}
testApiBridge().then(() => {
  console.log(`Passed ${passed} Apps Script contract tests (local stubs; no live Google writes).`);
}).catch(error => { console.error(error); process.exitCode = 1; });
