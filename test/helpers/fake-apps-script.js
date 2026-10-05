'use strict';
/**
 * Runs apps-script/Code.gs inside Node with a minimal fake of the Google services it uses,
 * served over HTTP like a deployed web app. Lets tests exercise the real script end-to-end.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

function createFakeSpreadsheet() {
  const sheets = new Map();
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
    getRange(r, c, nr = 1, nc = 1) {
      const sh = this;
      const read = () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = [];
          for (let j = 0; j < nc; j++) row.push((sh.rows[r - 1 + i] || [])[c - 1 + j] ?? '');
          out.push(row);
        }
        return out;
      };
      return {
        getValues: read,
        getDisplayValues: () => read().map((row) => row.map(String)),
        setValues(values) {
          if (values.length !== nr || values.some((v) => v.length !== nc)) throw new Error('range size mismatch');
          values.forEach((row, i) => {
            const target = (sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []);
            row.forEach((v, j) => { target[c - 1 + j] = v; });
          });
          for (let i = 0; i < sh.rows.length; i++) if (!sh.rows[i]) sh.rows[i] = [];
          return this;
        },
        setNumberFormat() { return this; },
      };
    }
    setFrozenRows() {}
    deleteRow(n) { this.rows.splice(n - 1, 1); }
  }
  return {
    sheets,
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; },
  };
}

function loadScript({ secret }) {
  const ss = createFakeSpreadsheet();
  const files = new Map();
  let fileSeq = 0;
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'SECRET' ? secret : null) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    Utilities: {
      base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }),
    },
    DriveApp: {
      getFoldersByName: () => ({ hasNext: () => true, next: () => ({
        createFile: (blob) => { const id = 'file' + ++fileSeq; files.set(id, blob); return { getId: () => id }; },
      }) }),
      getFileById: (id) => {
        const b = files.get(id);
        if (!b) throw new Error('No item with the given ID could be found');
        return { getBlob: () => ({ getContentType: () => b.mimeType, getBytes: () => b.bytes }) };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', 'Code.gs'), 'utf8'), context);
  return { context, ss, files };
}

/** Starts an HTTP server that behaves like the deployed web app (POST → doPost). */
async function startFakeWebApp({ secret = 'test-secret' } = {}) {
  const script = loadScript({ secret });
  let requests = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests++;
      const out = req.method === 'POST' ? script.context.doPost({ postData: { contents: body } }) : script.context.doGet();
      res.setHeader('Content-Type', 'application/json');
      res.end(out.text);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/exec`,
    secret,
    ss: script.ss,
    files: script.files,
    get requests() { return requests; },
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { startFakeWebApp };
