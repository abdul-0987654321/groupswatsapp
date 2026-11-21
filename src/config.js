'use strict';
/**
 * Coachings come from config/coachings.json (names, keywords, prices, group links).
 * Bank details come from config/payment.json and are never produced by AI.
 *
 * payment.json has two profiles: "live" (the client's account, EUR) and "test"
 * (a test account with tiny prices). "mode" — or env PAYMENT_MODE — picks one.
 */

const fs = require('fs');
const path = require('path');

const COACHINGS_FILE = process.env.COACHINGS_FILE || path.join(__dirname, '..', 'config', 'coachings.json'); // env override for tests
const MENUS_FILE = process.env.MENUS_FILE || path.join(__dirname, '..', 'config', 'menus.json'); // env override for tests
const PAYMENT_FILE = process.env.PAYMENT_FILE || path.join(__dirname, '..', 'config', 'payment.json'); // env override for tests

function loadPayment() {
  const raw = JSON.parse(fs.readFileSync(PAYMENT_FILE, 'utf8'));
  const mode = String(process.env.PAYMENT_MODE || raw.mode || 'live').toLowerCase();
  const profile = raw[mode];
  if (!profile) throw new Error(`config/payment.json: unknown mode "${mode}"`);
  for (const f of ['recipient', 'account', 'currency']) {
    if (!profile[f]) throw new Error(`config/payment.json: "${mode}.${f}" is empty`);
  }
  const toAccount = (a) =>
    Object.freeze({
      recipient: String(a.recipient),
      accountType: a.accountType === 'account' ? 'account' : 'iban',
      account: String(a.account),
      bic: a.bic ? String(a.bic) : '',
      bankName: a.bankName ? String(a.bankName) : '',
    });
  // Optional extra accounts that are also accepted as recipient (only the first one is shown to customers).
  const extra = (profile.extraAccounts || []).filter((a) => a.recipient && a.account).map(toAccount);
  return {
    mode,
    bank: toAccount(profile),
    accounts: Object.freeze([toAccount(profile), ...extra]),
    currency: String(profile.currency).toUpperCase(),
    prices: profile.prices || null,
    // time zone of the receipts (bank apps print local time): Pakistan for the test account, Germany live
    timezone: profile.timezone || (mode === 'test' ? 'Asia/Karachi' : 'Europe/Berlin'),
  };
}

const payment = loadPayment();
const MODE = payment.mode;
const BANK = payment.bank; // shown to customers
const ACCOUNTS = payment.accounts; // all accepted recipient accounts
const CURRENCY = payment.currency;
const TIMEZONE = payment.timezone;

function loadCoachings() {
  const raw = JSON.parse(fs.readFileSync(COACHINGS_FILE, 'utf8'));
  const list = Object.entries(raw).map(([id, c]) => {
    if (!c.name || typeof c.price !== 'number') throw new Error(`config/coachings.json: "${id}" needs a name and a numeric price`);
    return {
      id,
      name: String(c.name),
      keywords: (c.keywords || []).map((k) => String(k).toLowerCase()),
      price: payment.prices && typeof payment.prices[id] === 'number' ? payment.prices[id] : c.price,
      groupLink: String(c.groupLink || ''),
    };
  });
  if (!list.length) throw new Error('config/coachings.json has no coachings');
  return list;
}

const coachings = loadCoachings();

/**
 * Package menus (config/menus.json). A menu is a trigger code (e.g. "812") that opens a
 * numbered list of packages, each of which is an ordinary coaching from coachings.json.
 * The customer-facing texts live in the config file so wording changes need no code change.
 * Coachings that belong to a menu are reachable ONLY through it — never by keyword or AI —
 * so the bot still never lists everything it offers.
 */
function loadMenus() {
  if (!fs.existsSync(MENUS_FILE)) return [];
  const raw = JSON.parse(fs.readFileSync(MENUS_FILE, 'utf8'));
  return Object.entries(raw).map(([id, m]) => {
    const options = (m.options || []).map((o, i) => {
      const coaching = coachings.find((c) => c.id === o.id);
      if (!coaching) throw new Error(`config/menus.json: "${id}" refers to unknown coaching "${o.id}"`);
      const lang2 = (v, fallback) => (v ? Object.freeze({ de: String(v.de ?? fallback), en: String(v.en ?? v.de ?? fallback) }) : null);
      return Object.freeze({
        id: o.id,
        number: i + 1, // the number the customer answers with
        coaching,
        label: lang2(o.label, coaching.name) || Object.freeze({ de: coaching.name, en: coaching.name }),
        // optional second line under the menu entry, e.g. "alles mit drin"
        note: lang2(o.note, ''),
        // optional per-package wording that overrides the menu's own, e.g. a package that
        // gets a Zoom link by DM instead of the group link
        texts: Object.freeze({
          de: Object.freeze({ ...(o.texts?.de || {}) }),
          en: Object.freeze({ ...(o.texts?.en || o.texts?.de || {}) }),
        }),
        keywords: (o.keywords || []).map((k) => String(k).toLowerCase()),
      });
    });
    if (!options.length) throw new Error(`config/menus.json: "${id}" has no options`);
    if (!m.texts?.de?.intro) throw new Error(`config/menus.json: "${id}" needs texts.de.intro`);
    return Object.freeze({
      id,
      triggers: (m.triggers || []).map((t) => String(t).toLowerCase()),
      keywords: (m.keywords || []).map((k) => String(k).toLowerCase()),
      texts: Object.freeze({ de: Object.freeze({ ...m.texts.de }), en: Object.freeze({ ...(m.texts.en || m.texts.de) }) }),
      options: Object.freeze(options),
    });
  });
}

const menus = loadMenus();
const menuByCoaching = new Map();
const entryByCoaching = new Map(); // coaching id → { menu, option }
for (const menu of menus) {
  for (const o of menu.options) {
    menuByCoaching.set(o.id, menu);
    entryByCoaching.set(o.id, Object.freeze({ menu, option: o }));
  }
}

module.exports = {
  MODE,
  BANK,
  ACCOUNTS,
  CURRENCY,
  TIMEZONE,
  coachings,
  menus,
  getCoaching: (id) => coachings.find((c) => c.id === id) || null,
  /** The menu a coaching belongs to, or null for a normal standalone coaching. */
  getMenuForCoaching: (id) => menuByCoaching.get(id) || null,
  /** { menu, option } for a coaching sold through a menu, or null. */
  getMenuEntry: (id) => entryByCoaching.get(id) || null,
  getMenu: (id) => menus.find((m) => m.id === id) || null,
  /** Coachings that may be found by keyword or AI: everything that is not a menu package. */
  detectableCoachings: Object.freeze(coachings.filter((c) => !menuByCoaching.has(c.id))),
};
