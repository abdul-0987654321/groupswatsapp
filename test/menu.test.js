'use strict';
/**
 * Package menus: the Chemie Nachhilfe flow the client specified.
 *
 *   trigger "812" → numbered packages 1–4 → receipt requested (no bank details)
 *   → receipt verified → confirmation
 *
 * Verification is NOT skipped: an unclear receipt still goes to the review queue.
 * Only packages 2–4 lead into the group. The Probestunde is confirmed with its own
 * wording and gets its Zoom link by DM from the client instead.
 */
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { createHarness } = require('./helpers/harness');
const { BANK } = require('../src/config');

const OPTIONS =
  '1. Probestunde (Einheit 1) – 5 €\n' +
  '   (zum Reinschauen und Ausprobieren)\n' +
  '2. Komplettpaket (alle 10 Einheiten / 20 Stunden) – 100 €\n' +
  '   (alles mit drin)\n' +
  '3. Erste Hälfte (Einheiten 1–5) – 50 €\n' +
  '4. Zweite Hälfte (Einheiten 6–10) – 50 €';
const MENU = `Hey, welches Paket möchtest du wählen? Schreibe mir eine Zahl von 1-4\n\n${OPTIONS}`;
const RETRY = `Bitte antworte einfach mit der Nummer des Pakets (1–4).\n\n${OPTIONS}`;

const askReceipt = (paket) =>
  'Schick mir jetzt bitte den Zahlungsbeleg. Du kannst einfach einen Screenshot von der Überweisung als Bild hier reinschicken.\n\n' +
  `Name: Ilyas Lang\nIBAN: ${BANK.account}\n\nVerwendungszweck: Chemie Packet ${paket}`;
const LINK = 'https://chat.whatsapp.com/KxaB4OK7eeT8CCEX30ibVd?s=cl&p=i&iam=2';
const CONFIRMED = `Perfekt, du bist für die Nachhilfe freigeschaltet, vielen Dank!\n\n${LINK}`;
const PROBE_CONFIRMED =
  'Vielen Dank für deine Buchung, du bekommst den Zoom Link bis zu 1h vor dem Termin per PN';

/** option number → [coaching id, real price] */
const PACKAGES = { 1: ['CHEM_PROBE', 5], 2: ['CHEM_KOMPLETT', 100], 3: ['CHEM_H1', 50], 4: ['CHEM_H2', 50] };

const goodReceipt = (amount, extra = {}) => ({
  isPaymentReceipt: true, recipientName: 'Ilyas Lang', recipientIban: BANK.account, amount, currency: 'EUR',
  date: 'Heute', time: null, senderName: 'Max Muster', reference: 'Max Muster Chemie', bankApp: 'Sparkasse', ...extra,
});
const img = (seed) => {
  let x = seed * 2654435761;
  const px = Buffer.alloc(60 * 120 * 3).map(() => ((x = (x * 1103515245 + 12345) >>> 0) >>> 16) & 255);
  return sharp(px, { raw: { width: 60, height: 120, channels: 3 } }).png().toBuffer();
};
const withReceipt = (data) => createHarness({ receipts: { next: () => data } });

/** Books one package end to end and returns what the customer was told at the end. */
async function book(h, jid, option) {
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, String(option)));
  const out = await h.say(h.imageMsg(jid, await img(option * 7 + jid.length)));
  return out;
}

test('812 opens the menu with all four packages at their real prices', async () => {
  const h = await withReceipt(goodReceipt(50));
  assert.deepStrictEqual(await h.say(h.textMsg(h.phoneJid(1), '812')), [MENU]);
});

test('each package ends in the right confirmation, and only 2–4 get the link', async () => {
  for (const [option, [id, price]] of Object.entries(PACKAGES)) {
    const h = await withReceipt(goodReceipt(price));
    const jid = h.phoneJid(Number(option));
    const out = await book(h, jid, option);

    assert.strictEqual(h.payments.latestVerified(jid).coachingId, id, `package ${option} recorded wrong`);
    if (option === '1') {
      assert.deepStrictEqual(out, [PROBE_CONFIRMED], 'Probestunde must use its own wording');
      assert.ok(!out[0].includes('chat.whatsapp.com'), 'Probestunde must not receive the group link');
    } else {
      assert.deepStrictEqual(out, [CONFIRMED], `package ${option} should get the standard confirmation + link`);
    }
  }
});

test('the Probestunde confirmation promises the Zoom link by DM, not the group', async () => {
  const h = await withReceipt(goodReceipt(5));
  const jid = h.phoneJid(11);
  const [out] = await book(h, jid, 1);
  assert.ok(/Zoom Link/.test(out), out);
  assert.ok(!/kürze|shortly/i.test(out), 'must not promise a group link later');
});

test('the receipt request shows the bank details, with the chosen package number', async () => {
  for (const paket of ['1', '2', '3', '4']) {
    const h = await withReceipt(goodReceipt(5));
    const jid = h.phoneJid(50 + Number(paket));
    await h.say(h.textMsg(jid, '812'));
    const [ask] = await h.say(h.textMsg(jid, paket));
    assert.strictEqual(ask, askReceipt(paket));
  }
});

test('the IBAN shown to the customer is the one payments are verified against', async () => {
  // If these ever drift apart, every transfer fails as "Empfänger-IBAN stimmt nicht".
  const h = await withReceipt(goodReceipt(100));
  const jid = h.phoneJid(60);
  await h.say(h.textMsg(jid, '812'));
  const [ask] = await h.say(h.textMsg(jid, '2'));
  const shown = ask.match(/IBAN:\s*(.+)/)[1].trim();
  assert.strictEqual(shown, BANK.account, 'the message must use the IBAN from config/payment.json, never a hard-coded one');
  assert.ok(ask.includes(BANK.recipient), 'the recipient name must come from config too');
});

test('a payment to the IBAN we advertise actually verifies', async () => {
  const h = await withReceipt(goodReceipt(100, { recipientIban: BANK.account }));
  const jid = h.phoneJid(61);
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, '2'));
  const [out] = await h.say(h.imageMsg(jid, await img(61)));
  assert.strictEqual(out, CONFIRMED, 'a transfer to the advertised IBAN must pass verification');
});

test('no link or confirmation before the payment is verified', async () => {
  const h = await withReceipt(goodReceipt(100));
  const jid = h.phoneJid(13);
  const before = [...(await h.say(h.textMsg(jid, '812'))), ...(await h.say(h.textMsg(jid, '2')))];
  for (const text of before) assert.ok(!text.includes('chat.whatsapp.com'), `link sent too early: ${text}`);
});

test('wrong amount → review queue, not access (verification is not skipped)', async () => {
  const h = await withReceipt(goodReceipt(50)); // paid 50 € for the 100 € package
  const jid = h.phoneJid(14);
  const out = await book(h, jid, 2);
  assert.deepStrictEqual(out, ['Danke! Deine Zahlung wird kurz geprüft. Du bekommst gleich Bescheid.']);
  assert.strictEqual(h.payments.latestVerified(jid), null, 'no access on a wrong amount');
  assert.strictEqual(h.payments.forCustomer(jid)[0].status, h.payments.STATUS.NEEDS_REVIEW);
  assert.ok(!out.join('\n').includes('chat.whatsapp.com'));
});

test('admin approval sends the package wording — link for 3, Zoom text for 1', async () => {
  for (const [option, expected] of [['3', CONFIRMED], ['1', PROBE_CONFIRMED]]) {
    const h = await withReceipt(goodReceipt(7)); // wrong amount → lands in review
    const jid = h.phoneJid(20 + Number(option));
    await book(h, jid, option);
    const [p] = h.payments.forCustomer(jid);
    const before = h.sent.length;
    const res = await h.conversation.approvePayment(p.id);
    assert.deepStrictEqual(h.sent.slice(before).map((s) => s.text), [expected]);
    assert.ok(!res.warning, `admin should not be warned: ${res.warning}`);
  }
});

test('an unclear answer re-sends the menu and never starts a payment', async () => {
  const h = await withReceipt(goodReceipt(50));
  const jid = h.phoneJid(15);
  await h.say(h.textMsg(jid, '812'));
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'was kostet das?')), [RETRY]);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '9')), [RETRY], 'there is no package 9');
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '5')), [RETRY], 'package 5 no longer exists');
  assert.strictEqual(h.customers.get(jid).coachingId, null, 'no package chosen yet');
});

test('a receipt sent before picking a package is not accepted as payment', async () => {
  const h = await withReceipt(goodReceipt(50));
  const jid = h.phoneJid(16);
  await h.say(h.textMsg(jid, '812'));
  const out = await h.say(h.imageMsg(jid, await img(4)));
  assert.ok(out[0].includes('Nummer des Pakets'), 'should ask for the package first');
  assert.strictEqual(h.payments.forCustomer(jid).length, 0, 'nothing verified without a chosen package');
  assert.strictEqual(h.aiCalls.receipt, 0, 'no receipt is read before a package is known');
});

test('"812" inside a sentence is not a booking trigger', async () => {
  const h = await withReceipt(goodReceipt(50));
  const out = await h.say(h.textMsg(h.phoneJid(17), 'Ich habe 812 Euro überwiesen'));
  assert.ok(!out[0].includes('welches Paket'), `menu opened from a sentence: ${out[0]}`);
});

test('packages are never found by keyword or AI — only through the menu', async () => {
  const h = await createHarness({ classify: () => 'CHEM_KOMPLETT' }); // AI tries to name a package
  const jid = h.phoneJid(18);
  const out = await h.say(h.textMsg(jid, 'Ich will das Komplettpaket'));
  assert.ok(!out.join('\n').includes('chat.whatsapp.com'));
  assert.strictEqual(h.customers.get(jid).coachingId, null);
});

test('a second package can be booked after the first', async () => {
  const amounts = [5, 100];
  const h = await createHarness({ receipts: { next: () => goodReceipt(amounts.shift()) } });
  const jid = h.phoneJid(19);
  assert.deepStrictEqual(await book(h, jid, 1), [PROBE_CONFIRMED]);
  assert.deepStrictEqual(await book(h, jid, 2), [CONFIRMED]);
  const ids = h.payments.forCustomer(jid).filter((p) => p.status === h.payments.STATUS.VERIFIED).map((p) => p.coachingId);
  assert.deepStrictEqual(ids.sort(), ['CHEM_KOMPLETT', 'CHEM_PROBE']);
});

test('812 interrupts an ordinary coaching payment and switches to the menu', async () => {
  const h = await createHarness({ classify: () => 'C2' });
  const jid = h.phoneJid(30);
  await h.say(h.textMsg(jid, 'Money Coaching'));
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '812')), [MENU]);
  assert.strictEqual(h.customers.get(jid).stage, 'ask_package');
});
