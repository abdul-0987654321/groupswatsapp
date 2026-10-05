'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Sample test profile (fake Pakistani wallet) — loaded via PAYMENT_FILE + PAYMENT_MODE=test
const file = path.join(os.tmpdir(), `payment-test-${process.pid}.json`);
fs.writeFileSync(file, JSON.stringify({
  mode: 'live',
  live: { recipient: 'Ilyas Lang', accountType: 'iban', account: 'DE85 5505 0120 1200 6021 16', currency: 'EUR' },
  test: { recipient: 'Ali Raza', accountType: 'account', account: '0300 1234567', bankName: 'Easypaisa', currency: 'PKR', prices: { C1: 1, C2: 2, C3: 3, MAIN: 4 } },
}));
process.env.PAYMENT_FILE = file;
process.env.PAYMENT_MODE = 'test';
for (const k of Object.keys(require.cache)) if (k.includes('/src/')) delete require.cache[k];

const { createHarness } = require('./helpers/harness');

test('test mode: test prices, PKR, account number + bank in the price message', async () => {
  const h = await createHarness();
  const jid = h.phoneJid(1);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Money')), [
    'Das Money Coaching kostet 2 PKR. Bitte überweise an:\nEmpfänger: Ali Raza\nKontonummer: 0300 1234567\nBank: Easypaisa\n' +
      'Verwendungszweck: Dein Name + Money Coaching\nSchick mir danach einen Screenshot deiner Überweisung.',
  ]);
  require('../src/settings').set('botLanguage', 'en');
  const [en] = await h.say(h.textMsg(h.phoneJid(2), 'main'));
  assert.match(en, /^The Main Coaching costs 4 PKR\. Please transfer to:\nRecipient: Ali Raza\nAccount number: 0300 1234567\nBank: Easypaisa\n/);
});

test('test mode: Pakistani receipt checks (number formats, Rs, masked, wrong account)', () => {
  const { verify, accountMatches } = require('../src/verify');
  const { getCoaching } = require('../src/config');
  assert.strictEqual(accountMatches('03001234567'), true);
  assert.strictEqual(accountMatches('+92 300 1234567'), true);
  assert.strictEqual(accountMatches('****4567'), true);
  assert.strictEqual(accountMatches('PK36 TMFB 0000 0003 0012 34567'), true); // IBAN ending in the account number
  assert.strictEqual(accountMatches('03119876543'), false);
  const base = { isPaymentReceipt: true, recipientName: 'ALI RAZA', recipientIban: '0300****567', amount: 1, currency: 'Rs', date: '06 Oct 2026', time: '10:00', senderName: 'Test', reference: 'TID 123', bankApp: 'Easypaisa' };
  const ctx = { coaching: getCoaching('C1'), receivedAt: '2026-10-06T10:05:00+05:00', previousPayments: [] };
  assert.strictEqual(getCoaching('C1').price, 1);
  assert.deepStrictEqual(verify(base, ctx).reasons, []);
  assert.deepStrictEqual(verify({ ...base, amount: 10 }, ctx).reasons, ['Falscher Betrag: 10,00 PKR statt 1,00 PKR']);
  assert.deepStrictEqual(verify({ ...base, currency: 'EUR' }, ctx).reasons, ['Falsche Währung (EUR)']);
  assert.deepStrictEqual(verify({ ...base, recipientIban: '03119876543' }, ctx).reasons, ['Empfänger-Konto stimmt nicht (03119876543)']);
});

test.after(() => fs.rmSync(file, { force: true }));

test('extra accepted accounts: payment to the second account (by number or name) passes', () => {
  const file2 = path.join(os.tmpdir(), `payment-test2-${process.pid}.json`);
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.test.extraAccounts = [{ recipient: 'Sara Khan', accountType: 'account', account: '03451112223', bankName: 'JazzCash' }];
  fs.writeFileSync(file2, JSON.stringify(cfg));
  process.env.PAYMENT_FILE = file2;
  for (const k of Object.keys(require.cache)) if (k.includes('/src/')) delete require.cache[k];
  const { verify, accountMatches } = require('../src/verify');
  const { getCoaching } = require('../src/config');
  assert.strictEqual(accountMatches('0345 1112223'), true);
  assert.strictEqual(accountMatches('0300 1234567'), true);
  const r = verify(
    { isPaymentReceipt: true, recipientName: 'SARA KHAN', recipientIban: null, amount: 2, currency: 'PKR', date: 'Today', senderName: 'X', reference: null, bankApp: 'JazzCash' },
    { coaching: getCoaching('C2'), receivedAt: new Date().toISOString(), previousPayments: [] }
  );
  assert.deepStrictEqual(r.reasons, []);
  fs.rmSync(file2, { force: true });
  process.env.PAYMENT_FILE = file;
});
