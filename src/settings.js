'use strict';
/** Small key/value settings changed from the dashboard (stored in the "settings" sheet tab). */

const db = require('./storage/db');

const DEFAULTS = { botEnabled: true, botLanguage: 'de', adminNumbers: [], alertOnReview: true, alertOnVerified: true };

// Validators return the cleaned value or throw.
const VALIDATE = {
  botLanguage: (v) => {
    if (!['de', 'en'].includes(v)) throw new Error('Ungültiger Wert für botLanguage');
    return v;
  },
  // "+49 170 1234567, 0092300…" → ["491701234567", "92300…"]
  adminNumbers: (v) => {
    const list = (Array.isArray(v) ? v : String(v || '').split(/[,;\n]/))
      .map((n) => String(n).replace(/\D/g, '').replace(/^00/, ''))
      .filter(Boolean);
    for (const n of list) {
      if (n.startsWith('0') || n.length < 8 || n.length > 15) throw new Error(`Ungültige Admin-Nummer: ${n} (bitte mit Ländervorwahl, z. B. 49 170 1234567)`);
    }
    return [...new Set(list)];
  },
  botEnabled: (v) => Boolean(v), // false = bot paused: messages are saved, but no replies
  alertOnReview: (v) => Boolean(v),
  alertOnVerified: (v) => Boolean(v),
};

function get(key) {
  const row = db.get('settings', key);
  return row ? JSON.parse(row.value) : DEFAULTS[key];
}

function set(key, value) {
  if (!VALIDATE[key]) throw new Error(`Unbekannte Einstellung: ${key}`);
  const clean = VALIDATE[key](value);
  db.put('settings', { key, value: JSON.stringify(clean) });
  return clean;
}

function all() {
  return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, get(k)]));
}

module.exports = { get, set, all };
