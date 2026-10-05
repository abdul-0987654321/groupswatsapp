'use strict';
/** Small key/value settings changed from the dashboard (stored in the "settings" sheet tab). */

const db = require('./storage/db');

const DEFAULTS = { botLanguage: 'de' };
const ALLOWED = { botLanguage: ['de', 'en'] };

function get(key) {
  const row = db.get('settings', key);
  return row ? JSON.parse(row.value) : DEFAULTS[key];
}

function set(key, value) {
  if (!ALLOWED[key]) throw new Error(`Unbekannte Einstellung: ${key}`);
  if (!ALLOWED[key].includes(value)) throw new Error(`Ungültiger Wert für ${key}`);
  db.put('settings', { key, value: JSON.stringify(value) });
  return value;
}

function all() {
  return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, get(k)]));
}

module.exports = { get, set, all };
