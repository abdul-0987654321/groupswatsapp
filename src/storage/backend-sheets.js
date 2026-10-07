'use strict';
/**
 * Talks to the Apps Script web app in apps-script/Code.gs.
 * Every call is a POST with { secret, action, ... }; Apps Script answers with JSON.
 */

const log = require('../log');

const TIMEOUT_MS = 60000; // writes and files
const LOAD_TIMEOUT_MS = 180000; // reading a big tab (e.g. the WhatsApp session) can take a while

function createSheetsBackend({ url, secret }) {
  url = String(url || '').trim();
  secret = String(secret || '').trim().replace(/^["']|["']$/g, ''); // tolerate pasted quotes/spaces
  if (!url) throw new Error('SHEET_WEBHOOK_URL is not set');
  if (!secret) throw new Error('SHEET_SECRET is not set');

  async function call(action, payload = {}, attempts = 3, timeoutMs = TIMEOUT_MS) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret, action, ...payload }),
          redirect: 'follow', // Apps Script answers via a 302 to googleusercontent.com
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
        }
        if (!json.ok) throw new Error(`Apps Script error: ${json.error}`);
        return json;
      } catch (err) {
        lastErr = err;
        if (/unauthorized/.test(err.message)) break; // wrong secret: retrying won't help
        if (i < attempts) {
          log.warn(`Sheets ${action} failed (try ${i}/${attempts}): ${err.message}`);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }
    }
    throw lastErr;
  }

  return {
    name: 'google-sheets',
    // One request per tab, in parallel: smaller answers, and one slow tab doesn't block the others.
    async load(tables) {
      const parts = await Promise.all(
        tables.map(async (table) => {
          const started = Date.now();
          const rows = (await call('load', { tables: [table] }, 3, LOAD_TIMEOUT_MS)).data[table] || [];
          log.info(`Loaded sheet tab "${table}": ${rows.length} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);
          return [table, rows];
        })
      );
      return Object.fromEntries(parts);
    },
    async write(ops) {
      await call('write', { ops });
    },
    async putFile(name, mimeType, buffer) {
      return (await call('putFile', { name, mimeType, base64: buffer.toString('base64') })).id;
    },
    async getFile(id) {
      const r = await call('getFile', { id });
      return { mimeType: r.mimeType, buffer: Buffer.from(r.base64, 'base64') };
    },
  };
}

module.exports = { createSheetsBackend };
