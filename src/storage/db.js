'use strict';
/**
 * Data layer: everything lives in memory for speed and is written through to an
 * external backend (Google Sheets via Apps Script in production), because Render's
 * free tier wipes the local disk on every restart/deploy.
 *
 * Writes are batched: changes are queued and flushed every FLUSH_DELAY_MS in a single
 * request. On SIGTERM (Render deploy/restart) server.js calls flush() before exiting.
 */

const log = require('../log');

const FLUSH_DELAY_MS = 1500;
const MAX_CELL = 45000; // Google Sheets allows 50,000 characters per cell
const CHUNK_SEP = '__';

/**
 * Table definitions. `key` is the unique column. `view` produces the human-readable
 * columns shown in the sheet; the full record is always stored as JSON in `_json`
 * (except for the session table, which stores Baileys data as-is in `value`).
 */
const TABLES = {
  session: { key: 'key', raw: true },
  settings: { key: 'key', raw: true }, // dashboard settings, e.g. botLanguage
  customers: {
    key: 'jid',
    view: (c) => ({
      jid: c.jid,
      phone: c.phone,
      name: c.name,
      pushName: c.pushName,
      stage: c.stage,
      coachingId: c.coachingId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }),
  },
  payments: {
    key: 'id',
    view: (p) => ({
      id: p.id,
      jid: p.jid,
      phone: p.phone,
      name: p.name,
      coachingId: p.coachingId,
      amount: p.amount,
      expectedAmount: p.expectedAmount,
      status: p.status,
      reasons: Array.isArray(p.reasons) ? p.reasons.join(' | ') : '',
      paymentDate: p.paymentDate,
      receivedAt: p.receivedAt,
      decidedAt: p.decidedAt,
      screenshotFileId: p.screenshotFileId,
    }),
  },
  chat: {
    key: 'id',
    view: (m) => ({ id: m.id, at: m.at, jid: m.jid, direction: m.direction, text: m.text }),
  },
};

let backend = null;
const cache = {}; // table -> Map(key -> record)
const queue = {}; // table -> { upsert: Map(key -> record), remove: Set(key) }
const chunkedCols = {}; // table -> Set(column) that have ever been split
let timer = null;
let flushing = null;
let lastFlushError = null;
let lastFlushAt = null;

for (const t of Object.keys(TABLES)) {
  cache[t] = new Map();
  queue[t] = { upsert: new Map(), remove: new Set() };
  chunkedCols[t] = new Set();
}

// ---------- (de)serialization ----------

function toFlat(table, record) {
  const def = TABLES[table];
  const flat = def.raw ? { key: record.key, value: record.value } : { ...def.view(record), _json: JSON.stringify(record) };
  const out = {};
  for (const [col, val] of Object.entries(flat)) {
    const s = val == null ? '' : String(val);
    if (s.length <= MAX_CELL) {
      out[col] = s;
      if (chunkedCols[table].has(col)) out[col + CHUNK_SEP + 2] = ''; // terminate stale chunks
      continue;
    }
    chunkedCols[table].add(col);
    const parts = Math.ceil(s.length / MAX_CELL);
    for (let i = 0; i < parts; i++) {
      out[i === 0 ? col : col + CHUNK_SEP + (i + 1)] = s.slice(i * MAX_CELL, (i + 1) * MAX_CELL);
    }
    out[col + CHUNK_SEP + (parts + 1)] = '';
  }
  return out;
}

function joinChunks(table, row, col) {
  let s = row[col] || '';
  for (let i = 2; row[col + CHUNK_SEP + i]; i++) {
    chunkedCols[table].add(col);
    s += row[col + CHUNK_SEP + i];
  }
  return s;
}

function fromFlat(table, row) {
  const def = TABLES[table];
  if (def.raw) return { key: row.key, value: joinChunks(table, row, 'value') };
  const json = joinChunks(table, row, '_json');
  if (!json) return null;
  return JSON.parse(json);
}

// ---------- public API ----------

async function init(b) {
  backend = b;
  await reload(Object.keys(TABLES));
}

/** Re-reads tables from the backend (pending local changes for those tables win). */
async function reload(tables) {
  const data = await backend.load(tables);
  for (const [table, rows] of Object.entries(data)) {
    cache[table].clear();
    for (const row of rows) {
      try {
        const rec = fromFlat(table, row);
        const key = rec && String(rec[TABLES[table].key]);
        if (rec && !queue[table].upsert.has(key) && !queue[table].remove.has(key)) cache[table].set(key, rec);
      } catch (err) {
        log.warn(`Skipping unreadable ${table} row: ${err.message}`);
      }
    }
    for (const [key, rec] of queue[table].upsert) cache[table].set(key, rec); // not yet saved: keep local version
  }
  log.info(`Loaded from ${backend.name}: ` + tables.map((t) => `${t}=${cache[t].size}`).join(', '));
}

function get(table, key) {
  return cache[table].get(String(key)) || null;
}

function all(table) {
  return Array.from(cache[table].values());
}

function put(table, record) {
  const key = String(record[TABLES[table].key]);
  cache[table].set(key, record);
  queue[table].upsert.set(key, record);
  queue[table].remove.delete(key);
  schedule();
  return record;
}

function remove(table, key) {
  key = String(key);
  cache[table].delete(key);
  queue[table].upsert.delete(key);
  queue[table].remove.add(key);
  schedule();
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

function pendingCount() {
  return Object.values(queue).reduce((n, q) => n + q.upsert.size + q.remove.size, 0);
}

/** Sends all queued changes. Safe to call concurrently; resolves when everything queued so far is written. */
async function flush() {
  while (flushing) await flushing; // one request at a time keeps writes in order
  if (!backend || pendingCount() === 0) return;

  const ops = [];
  const sent = {};
  for (const table of Object.keys(TABLES)) {
    const q = queue[table];
    if (!q.upsert.size && !q.remove.size) continue;
    sent[table] = { upsert: new Map(q.upsert), remove: new Set(q.remove) };
    q.upsert.clear();
    q.remove.clear();
    ops.push({
      table,
      key: TABLES[table].key,
      upsert: Array.from(sent[table].upsert.values()).map((r) => toFlat(table, r)),
      remove: Array.from(sent[table].remove),
    });
  }

  flushing = (async () => {
    try {
      await backend.write(ops);
      lastFlushAt = new Date().toISOString();
      lastFlushError = null;
    } catch (err) {
      lastFlushError = err.message;
      log.error(`Saving to ${backend.name} failed, will retry: ${err.message}`);
      // Put back whatever wasn't changed again in the meantime.
      for (const [table, s] of Object.entries(sent)) {
        const q = queue[table];
        for (const [k, r] of s.upsert) if (!q.upsert.has(k) && !q.remove.has(k)) q.upsert.set(k, r);
        for (const k of s.remove) if (!q.upsert.has(k) && !q.remove.has(k)) q.remove.add(k);
      }
      setTimeout(schedule, 5000).unref?.();
    }
  })();
  try {
    await flushing;
  } finally {
    flushing = null;
  }
}

function status() {
  return { backend: backend?.name || null, pending: pendingCount(), lastFlushAt, lastFlushError };
}

async function putFile(name, mimeType, buffer) {
  return backend.putFile(name, mimeType, buffer);
}

async function getFile(id) {
  return backend.getFile(id);
}

module.exports = { TABLES, init, reload, get, all, put, remove, flush, status, putFile, getFile, _toFlat: toFlat, _fromFlat: fromFlat };
