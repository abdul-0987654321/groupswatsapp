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

const COACHINGS_FILE = path.join(__dirname, '..', 'config', 'coachings.json');
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

module.exports = {
  MODE,
  BANK,
  ACCOUNTS,
  CURRENCY,
  TIMEZONE,
  coachings,
  getCoaching: (id) => coachings.find((c) => c.id === id) || null,
};
