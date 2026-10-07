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
  // last used customer/payment numbers, so a number is never given out twice (even after deleting)
  counters: (v) => ({ K: Number(v?.K) || 0, Z: Number(v?.Z) || 0 }),
  // salted scrypt hash, written only by auth.changePassword (never via the public settings API)
  dashboardPassword: (v) => {
    if (!v || typeof v.salt !== 'string' || typeof v.hash !== 'string') throw new Error('Ungültiges Passwort-Format');
    return { salt: v.salt, hash: v.hash, changedAt: v.changedAt || null };
  },
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

// Settings the dashboard may read and change through /api/settings.
const PUBLIC = ['botEnabled', 'botLanguage', 'adminNumbers', 'alertOnReview', 'alertOnVerified'];

/** Next number for "K" (customers) or "Z" (payments); never reuses a number, even after deletes. */
function nextNumber(prefix, existingMax) {
  const counters = { K: 0, Z: 0, ...(get('counters') || {}) };
  const n = Math.max(1000, counters[prefix] || 0, existingMax || 0) + 1;
  set('counters', { ...counters, [prefix]: n });
  return n;
}

function all() {
  return Object.fromEntries(PUBLIC.map((k) => [k, get(k)]));
}

module.exports = { get, set, all, PUBLIC, nextNumber };
