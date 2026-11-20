'use strict';
/**
 * Package menus: the Chemie Nachhilfe flow the client specified.
 *
 *   trigger "812" → numbered packages 1–5 → receipt requested (no bank details)
 *   → receipt verified → client's confirmation wording + group link
 *
 * Verification is NOT skipped for these packages: an unclear receipt still goes to review.
 */
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { createHarness } = require('./helpers/harness');

const MENU =
  'Hey, welches Paket möchtest du wählen?\n\n' +
  '1. Probestunde – 5 €\n' +
  '2. Komplettpaket – 100 €\n' +
  '3. Thema 1 bis 5 – 45 €\n' +
  '4. Thema 5 bis 10 – 45 €\n' +
  '5. Thema 10 bis 15 – 45 €';
const ASK_RECEIPT =
  'Schick mir jetzt bitte den Zahlungsbeleg. Du kannst einfach einen Screenshot von der Überweisung als Bild hier reinschicken.';
const LINK = 'https://chat.whatsapp.com/KxaB4OK7eeT8CCEX30ibVd?s=cl&p=i&iam=2';
const CONFIRMED = `Perfekt, du bist für die Nachhilfe freigeschaltet, vielen Dank!\n\n${LINK}`;

const goodReceipt = (amount, extra = {}) => ({
  isPaymentReceipt: true, recipientName: 'Ilyas Lang', recipientIban: 'DE85 5505 0120 1200 6021 16', amount, currency: 'EUR',
  date: 'Heute', time: null, senderName: 'Max Muster', reference: 'Max Muster Chemie', bankApp: 'Sparkasse', ...extra,
});
const img = (seed) => {
  let x = seed * 2654435761;
  const px = Buffer.alloc(60 * 120 * 3).map(() => ((x = (x * 1103515245 + 12345) >>> 0) >>> 16) & 255);
  return sharp(px, { raw: { width: 60, height: 120, channels: 3 } }).png().toBuffer();
};
const withReceipt = (data) => createHarness({ receipts: { next: () => data } });

test('812 → menu, number → receipt request, valid receipt → confirmation + link', async () => {
  const h = await withReceipt(goodReceipt(45));
  const jid = h.phoneJid(1);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '812')), [MENU]);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '3')), [ASK_RECEIPT]);
  assert.deepStrictEqual(await h.say(h.imageMsg(jid, await img(1))), [CONFIRMED]);

  const paid = h.payments.latestVerified(jid);
  assert.strictEqual(paid.coachingId, 'CHEM_T1', 'the package the customer picked is what gets recorded');
});

test('the receipt request never contains bank details (they are in the group announcement)', async () => {
  const h = await withReceipt(goodReceipt(5));
  const jid = h.phoneJid(2);
  await h.say(h.textMsg(jid, '812'));
  const [ask] = await h.say(h.textMsg(jid, '1'));
  for (const secret of ['IBAN', 'DE85', 'Empfänger', 'Verwendungszweck']) {
    assert.ok(!ask.includes(secret), `receipt request leaks "${secret}"`);
  }
});

test('the group link is never sent before the payment is verified', async () => {
  const h = await withReceipt(goodReceipt(45));
  const jid = h.phoneJid(3);
  const before = [...(await h.say(h.textMsg(jid, '812'))), ...(await h.say(h.textMsg(jid, '4')))];
  for (const text of before) assert.ok(!text.includes('chat.whatsapp.com'), `link sent too early: ${text}`);
});

test('wrong amount → review queue, not access (verification is not skipped)', async () => {
  const h = await withReceipt(goodReceipt(5)); // paid 5 € for the 100 € package
  const jid = h.phoneJid(4);
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, '2'));
  const out = await h.say(h.imageMsg(jid, await img(2)));
  assert.deepStrictEqual(out, ['Danke! Deine Zahlung wird kurz geprüft. Du bekommst gleich Bescheid.']);
  assert.strictEqual(h.payments.latestVerified(jid), null, 'no access on a wrong amount');
  const [p] = h.payments.forCustomer(jid);
  assert.strictEqual(p.status, h.payments.STATUS.NEEDS_REVIEW);
  assert.ok(!out.join('\n').includes('chat.whatsapp.com'));
});

test('admin approval from the dashboard sends the client wording, not the standard text', async () => {
  const h = await withReceipt(goodReceipt(5));
  const jid = h.phoneJid(5);
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, '2'));
  await h.say(h.imageMsg(jid, await img(3)));
  const [p] = h.payments.forCustomer(jid);
  const before = h.sent.length;
  await h.conversation.approvePayment(p.id);
  assert.deepStrictEqual(h.sent.slice(before).map((s) => s.text), [CONFIRMED]);
});

test('an unclear answer re-sends the menu and never starts a payment', async () => {
  const h = await withReceipt(goodReceipt(45));
  const jid = h.phoneJid(6);
  await h.say(h.textMsg(jid, '812'));
  const retry = 'Bitte antworte einfach mit der Nummer des Pakets (1–5).\n\n' + MENU.split('\n\n')[1];
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'was kostet das?')), [retry]);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '9')), [retry]);
  assert.strictEqual(h.customers.get(jid).coachingId, null, 'no package chosen yet');
});

test('a receipt sent before picking a package is not accepted as payment', async () => {
  const h = await withReceipt(goodReceipt(45));
  const jid = h.phoneJid(7);
  await h.say(h.textMsg(jid, '812'));
  const out = await h.say(h.imageMsg(jid, await img(4)));
  assert.ok(out[0].includes('Nummer des Pakets'), 'should ask for the package first');
  assert.strictEqual(h.payments.forCustomer(jid).length, 0, 'nothing verified without a chosen package');
  assert.strictEqual(h.aiCalls.receipt, 0, 'no receipt is read before a package is known');
});

test('"812" inside a sentence is not a booking trigger', async () => {
  const h = await withReceipt(goodReceipt(45));
  const jid = h.phoneJid(8);
  const out = await h.say(h.textMsg(jid, 'Ich habe 812 Euro überwiesen'));
  assert.ok(!out[0].includes('welches Paket'), `menu opened from a sentence: ${out[0]}`);
});

test('packages are never found by keyword or AI — only through the menu', async () => {
  const h = await createHarness({ classify: () => 'CHEM_KOMPLETT' }); // AI tries to name a package
  const jid = h.phoneJid(9);
  const out = await h.say(h.textMsg(jid, 'Ich will das Komplettpaket'));
  assert.ok(!out.join('\n').includes('chat.whatsapp.com'));
  assert.strictEqual(h.customers.get(jid).coachingId, null);
});

test('a second package can be booked after the first (different amounts, same group)', async () => {
  const amounts = [45, 100];
  const h = await createHarness({ receipts: { next: () => goodReceipt(amounts.shift()) } });
  const jid = h.phoneJid(10);
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, '3'));
  assert.deepStrictEqual(await h.say(h.imageMsg(jid, await img(5))), [CONFIRMED]);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '812')), [MENU]);
  await h.say(h.textMsg(jid, '2'));
  assert.deepStrictEqual(await h.say(h.imageMsg(jid, await img(6))), [CONFIRMED]);
  const ids = h.payments.forCustomer(jid).filter((p) => p.status === h.payments.STATUS.VERIFIED).map((p) => p.coachingId);
  assert.deepStrictEqual(ids.sort(), ['CHEM_KOMPLETT', 'CHEM_T1']);
});

test('812 interrupts an ordinary coaching payment and switches to the menu', async () => {
  const h = await createHarness({ classify: () => 'C2' });
  const jid = h.phoneJid(11);
  await h.say(h.textMsg(jid, 'Money Coaching'));
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '812')), [MENU]);
  assert.strictEqual(h.customers.get(jid).stage, 'ask_package');
});
