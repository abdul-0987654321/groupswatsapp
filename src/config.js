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
  return {
    mode,
    bank: Object.freeze({
      recipient: String(profile.recipient),
      accountType: profile.accountType === 'account' ? 'account' : 'iban',
      account: String(profile.account),
      bic: profile.bic ? String(profile.bic) : '',
      bankName: profile.bankName ? String(profile.bankName) : '',
    }),
    currency: String(profile.currency).toUpperCase(),
    prices: profile.prices || null,
  };
}

const payment = loadPayment();
const MODE = payment.mode;
const BANK = payment.bank;
const CURRENCY = payment.currency;

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
  CURRENCY,
  coachings,
  getCoaching: (id) => coachings.find((c) => c.id === id) || null,
};
