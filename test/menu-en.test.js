'use strict';
/** The Chemie package flow with the bot language set to English (dashboard → Bot-Sprache). */
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { createHarness } = require('./helpers/harness');
const { BANK } = require('../src/config');

const OPTIONS_EN =
  '1. Trial lesson (unit 1) – 5 €\n' +
  '   (to have a look and try it out)\n' +
  '2. Complete package (all 10 units / 20 hours) – 100 €\n' +
  '   (everything included)\n' +
  '3. First half (units 1–5) – 50 €\n' +
  '4. Second half (units 6–10) – 50 €';
const MENU_EN = `Hey, which package would you like to choose? Just send me a number from 1-4\n\n${OPTIONS_EN}`;

const askEn = (paket) =>
  'Please send me the payment receipt now. You can simply send a screenshot of the bank transfer as an image here.\n\n' +
  `Name: Ilyas Lang\nIBAN: ${BANK.account}\n\nReference: Chemie Packet ${paket}`;
const LINK = 'https://chat.whatsapp.com/KxaB4OK7eeT8CCEX30ibVd?s=cl&p=i&iam=2';
const CONFIRMED_EN = `Perfect, you are now registered for the tutoring, thank you very much!\n\n${LINK}`;
const PROBE_EN =
  'Thank you for your booking, you will receive the Zoom link up to 1 hour before the appointment by direct message';

const goodReceipt = (amount) => ({
  isPaymentReceipt: true, recipientName: 'Ilyas Lang', recipientIban: BANK.account, amount, currency: 'EUR',
  date: 'Heute', time: null, senderName: 'Max Muster', reference: 'Max Muster Chemie', bankApp: 'Sparkasse',
});
const img = (seed) => {
  let x = seed * 2654435761;
  const px = Buffer.alloc(60 * 120 * 3).map(() => ((x = (x * 1103515245 + 12345) >>> 0) >>> 16) & 255);
  return sharp(px, { raw: { width: 60, height: 120, channels: 3 } }).png().toBuffer();
};

async function englishHarness(receipt) {
  const h = await createHarness({ receipts: { next: () => receipt } });
  require('../src/settings').set('botLanguage', 'en');
  return h;
}

test('English: 812 → menu → package → receipt → confirmation + link', async () => {
  const h = await englishHarness(goodReceipt(100));
  const jid = h.phoneJid(1);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '812')), [MENU_EN]);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '2')), [askEn('2')]);
  assert.deepStrictEqual(await h.say(h.imageMsg(jid, await img(1))), [CONFIRMED_EN]);
  assert.strictEqual(h.payments.latestVerified(jid).coachingId, 'CHEM_KOMPLETT');
});

test('English: the trial lesson gets its own Zoom wording and no group link', async () => {
  const h = await englishHarness(goodReceipt(5));
  const jid = h.phoneJid(2);
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, '1'));
  const [out] = await h.say(h.imageMsg(jid, await img(2)));
  assert.strictEqual(out, PROBE_EN);
});

test('English: both halves receive the group link', async () => {
  for (const [option, id] of [['3', 'CHEM_H1'], ['4', 'CHEM_H2']]) {
    const h = await englishHarness(goodReceipt(50));
    const jid = h.phoneJid(10 + Number(option));
    await h.say(h.textMsg(jid, '812'));
    await h.say(h.textMsg(jid, option));
    const [out] = await h.say(h.imageMsg(jid, await img(10 + Number(option))));
    assert.strictEqual(out, CONFIRMED_EN);
    assert.strictEqual(h.payments.latestVerified(jid).coachingId, id);
  }
});

test('English: the trigger and the package keywords work the same', async () => {
  const h = await englishHarness(goodReceipt(5));
  const jid = h.phoneJid(3);
  await h.say(h.textMsg(jid, '812'));
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'trial')), [askEn('1')]);
});

test('English: a wrong amount still goes to review, in English', async () => {
  const h = await englishHarness(goodReceipt(5)); // 5 € for the 100 € package
  const jid = h.phoneJid(4);
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, '2'));
  const out = await h.say(h.imageMsg(jid, await img(4)));
  assert.deepStrictEqual(out, ['Thank you! Your payment is being checked. You will hear from us shortly.']);
  assert.strictEqual(h.payments.latestVerified(jid), null);
});

test('English: an unclear answer re-sends the menu in English', async () => {
  const h = await englishHarness(goodReceipt(50));
  const jid = h.phoneJid(5);
  await h.say(h.textMsg(jid, '812'));
  const [retry] = await h.say(h.textMsg(jid, 'how much?'));
  assert.ok(retry.startsWith('Please just reply with the number of the package (1–4).'), retry);
  assert.ok(retry.includes('1. Trial lesson (unit 1) – 5 €'));
});

test('English: ordinary coachings are unaffected', async () => {
  const h = await createHarness({ classify: () => 'C2' });
  require('../src/settings').set('botLanguage', 'en');
  assert.deepStrictEqual(await h.say(h.textMsg(h.phoneJid(6), 'Hello')), ['Welcome! Which coaching are you interested in?']);
});
