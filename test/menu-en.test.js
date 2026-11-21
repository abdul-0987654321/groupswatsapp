'use strict';
/** The Chemie package flow with the bot language set to English (dashboard → Bot-Sprache). */
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { createHarness } = require('./helpers/harness');

const MENU_EN =
  'Hey, which package would you like to choose?\n\n' +
  '1. Trial lesson – 5 €\n' +
  '2. Complete package – 100 €\n' +
  '3. Topics 1 to 5 – 45 €\n' +
  '4. Topics 5 to 10 – 45 €\n' +
  '5. Topics 10 to 15 – 45 €';
const ASK_EN =
  'Please send me the payment receipt now. You can simply send a screenshot of the bank transfer as an image here.';
const LINK = 'https://chat.whatsapp.com/KxaB4OK7eeT8CCEX30ibVd?s=cl&p=i&iam=2';
const CONFIRMED_EN = `Perfect, you are now registered for the tutoring, thank you very much!\n\n${LINK}`;

const goodReceipt = (amount) => ({
  isPaymentReceipt: true, recipientName: 'Ilyas Lang', recipientIban: 'DE85 5505 0120 1200 6021 16', amount, currency: 'EUR',
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
  const h = await englishHarness(goodReceipt(45));
  const jid = h.phoneJid(1);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '812')), [MENU_EN]);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '3')), [ASK_EN]);
  assert.deepStrictEqual(await h.say(h.imageMsg(jid, await img(1))), [CONFIRMED_EN]);
  assert.strictEqual(h.payments.latestVerified(jid).coachingId, 'CHEM_T1');
});

test('English: the trigger and the package keywords are the same in both languages', async () => {
  const h = await englishHarness(goodReceipt(5));
  const jid = h.phoneJid(2);
  await h.say(h.textMsg(jid, '812'));
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'trial')), [ASK_EN]);
});

test('English: a wrong amount still goes to review, in English', async () => {
  const h = await englishHarness(goodReceipt(5)); // 5 € for the 100 € package
  const jid = h.phoneJid(3);
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, '2'));
  const out = await h.say(h.imageMsg(jid, await img(2)));
  assert.deepStrictEqual(out, ['Thank you! Your payment is being checked. You will hear from us shortly.']);
  assert.strictEqual(h.payments.latestVerified(jid), null);
});

test('English: an unclear answer re-sends the menu in English', async () => {
  const h = await englishHarness(goodReceipt(45));
  const jid = h.phoneJid(4);
  await h.say(h.textMsg(jid, '812'));
  const [retry] = await h.say(h.textMsg(jid, 'how much?'));
  assert.ok(retry.startsWith('Please just reply with the number of the package (1–5).'), retry);
  assert.ok(retry.includes('1. Trial lesson – 5 €'));
});

test('English: ordinary coachings are unaffected', async () => {
  const h = await createHarness({ classify: () => 'C2' });
  require('../src/settings').set('botLanguage', 'en');
  const jid = h.phoneJid(5);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Hello')), ['Welcome! Which coaching are you interested in?']);
});
