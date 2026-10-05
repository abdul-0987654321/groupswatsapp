'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { createHarness } = require('./helpers/harness');
const { coachings } = require('../src/config');

const PRICE_C2 =
  'Das Money Coaching kostet 80 €. Bitte überweise an:\n' +
  'Empfänger: Ilyas Lang\n' +
  'IBAN: DE85 5505 0120 1200 6021 16\n' +
  'Verwendungszweck: Dein Name + Money Coaching\n' +
  'Schick mir danach einen Screenshot deiner Überweisung.';

const goodReceipt = (amount, extra = {}) => ({
  isPaymentReceipt: true, recipientName: 'Ilyas Lang', recipientIban: 'DE85 5505 0120 1200 6021 16', amount, currency: 'EUR',
  date: 'Heute', time: '12:00', senderName: 'Max Muster', reference: 'Max Muster Coaching', bankApp: 'Sparkasse', ...extra,
});
// Distinct random-noise images (deterministic per seed), so they never look like duplicates.
const img = (seed) => {
  let x = seed * 2654435761;
  const px = Buffer.alloc(60 * 120 * 3).map(() => ((x = (x * 1103515245 + 12345) >>> 0) >>> 16) & 255);
  return sharp(px, { raw: { width: 60, height: 120, channels: 3 } }).png().toBuffer();
};

/** No bot message may ever mention two or more coachings (= a list). */
function assertNoList(sent) {
  for (const { text } of sent) {
    const named = coachings.filter((c) => text.includes(c.name));
    assert.ok(named.length <= 1, `message lists coachings: ${text}`);
  }
}

test('greeting → welcome, unclear → ask again (no list), greetings never call the AI', async () => {
  const h = await createHarness({ classify: () => 'UNKNOWN' });
  const jid = h.phoneJid(1);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Hallo')), ['Willkommen! Für welches Coaching interessierst du dich?']);
  assert.strictEqual(h.aiCalls.classify, 0);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Was habt ihr denn so?')), ['Für welches Coaching interessierst du dich?']);
  assert.strictEqual(h.aiCalls.classify, 1);
  assertNoList(h.sent);
});

test('keyword detection: natural sentences, compounds, typos, umlauts', async () => {
  const cases = [
    ['ich will das Money Coaching', 'C2'], ['Sport', 'C1'], ['Sportcoaching bitte', 'C1'], ['sprot', 'C1'],
    ['Interesse an Geld!', 'C2'], ['mony coaching', 'C2'], ['Sprachcoaching', 'C3'], ['language', 'C3'],
    ['das HAUPT coaching', 'MAIN'], ['main', 'MAIN'],
  ];
  const { keywordMatches } = require('../src/coaching-detect');
  for (const [text, want] of cases) assert.deepStrictEqual(keywordMatches(text), [want], text);
  // Short keywords must not match longer words
  assert.deepStrictEqual(keywordMatches('wie lange dauert das? ich wohne in Mainz'), []);
});

test('coaching chosen → exact price + bank details from config', async () => {
  const h = await createHarness();
  const jid = h.phoneJid(2);
  await h.say(h.textMsg(jid, 'Hi'));
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'ich will das Money Coaching')), [PRICE_C2]);
  assert.strictEqual(h.customers.get(jid).stage, 'awaiting_screenshot');
  assert.strictEqual(h.customers.get(jid).coachingId, 'C2');
});

test('first message can already name the coaching', async () => {
  const h = await createHarness();
  const [out] = await h.say(h.textMsg(h.phoneJid(3), 'Hallo, ich interessiere mich für das Main Coaching'));
  assert.match(out, /^Das Main Coaching kostet 90 €/);
});

test('AI fallback only returns a code; anything else counts as UNKNOWN', async () => {
  let answer = 'C3';
  const h = await createHarness({ classify: () => answer });
  const jid = h.phoneJid(4);
  const [out] = await h.say(h.textMsg(jid, 'ich möchte besser Englisch reden können'));
  assert.match(out, /^Das Lang Coaching kostet 85 €/);

  answer = 'Das Sport Coaching kostet 10 €'; // AI tries to write text → ignored
  const jid2 = h.phoneJid(5);
  await h.say(h.textMsg(jid2, 'Hallo'));
  assert.deepStrictEqual(await h.say(h.textMsg(jid2, 'irgendwas mit Fitness')), ['Für welches Coaching interessierst du dich?']);
});

test('text instead of screenshot → reminder; clear keyword switches coaching', async () => {
  const h = await createHarness();
  const jid = h.phoneJid(6);
  await h.say(h.textMsg(jid, 'Sport'));
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'mache ich gleich')), [
    'Du hast das Sport Coaching gewählt (75 €). Bitte schick mir einen Screenshot deiner Überweisung (als Bild oder PDF), damit ich die Zahlung prüfen kann.\n' +
      'Möchtest du ein anderes Coaching? Schreib mir einfach, welches.',
  ]);
  const [out] = await h.say(h.textMsg(jid, 'doch lieber Geld'));
  assert.match(out, /^Das Money Coaching kostet 80 €/);
});

test('image before choosing a coaching → asks for the coaching', async () => {
  const h = await createHarness();
  assert.deepStrictEqual(await h.say(h.imageMsg(h.phoneJid(7), await img(1))), ['Willkommen! Für welches Coaching interessierst du dich?']);
});

test('full flow: verified receipt → link; writing again → same link, no restart', async () => {
  const queue = [goodReceipt(75)];
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  require('../src/config').getCoaching('C1').groupLink = 'https://chat.whatsapp.com/TEST-SPORT';
  const jid = h.phoneJid(8);
  await h.say(h.textMsg(jid, 'Hallo'));
  await h.say(h.textMsg(jid, 'Sport'));
  assert.deepStrictEqual(await h.say(h.imageMsg(jid, await img(2))), [
    'Zahlung bestätigt ✅ Hier ist dein Link zur Coaching-Gruppe: https://chat.whatsapp.com/TEST-SPORT',
  ]);
  assert.strictEqual(h.customers.get(jid).stage, 'verified');
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Hallo, ich finde den Link nicht')), [
    'Du bist bereits freigeschaltet ✅ Hier ist dein Link zur Coaching-Gruppe: https://chat.whatsapp.com/TEST-SPORT',
  ]);
  assertNoList(h.sent);
});

test('needs review → admin confirms → link sent automatically', async () => {
  const queue = [goodReceipt(70)]; // wrong amount
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  require('../src/config').getCoaching('C2').groupLink = 'https://chat.whatsapp.com/TEST-MONEY';
  const jid = h.phoneJid(9);
  await h.say(h.textMsg(jid, 'Money'));
  assert.deepStrictEqual(await h.say(h.imageMsg(jid, await img(3))), ['Danke! Deine Zahlung wird kurz geprüft. Du bekommst gleich Bescheid.']);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'und?')), ['Deine Zahlung wird gerade noch geprüft. Du bekommst gleich Bescheid.']);
  const [p] = h.payments.all();
  assert.strictEqual(p.status, 'NEEDS_REVIEW');
  assert.deepStrictEqual(p.reasons, ['Falscher Betrag: 70,00 € statt 80,00 €']);
  const before = h.sent.length;
  assert.deepStrictEqual(await h.conversation.approvePayment(p.id), { ok: true });
  assert.deepStrictEqual(h.sent.slice(before).map((s) => s.text), ['Zahlung bestätigt ✅ Hier ist dein Link zur Coaching-Gruppe: https://chat.whatsapp.com/TEST-MONEY']);
  assert.strictEqual(h.customers.get(jid).stage, 'verified');
});

test('admin rejects → rejection text, customer can send a new receipt', async () => {
  const queue = [goodReceipt(85, { recipientName: 'Someone Else', recipientIban: 'DE02 1203 0000 0000 2020 51' }), goodReceipt(85, { reference: 'neu' })];
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  require('../src/config').getCoaching('C3').groupLink = 'https://chat.whatsapp.com/TEST-LANG';
  const jid = h.phoneJid(10);
  await h.say(h.textMsg(jid, 'Sprache'));
  await h.say(h.imageMsg(jid, await img(4)));
  const [p] = h.payments.all();
  const before = h.sent.length;
  await h.conversation.rejectPayment(p.id);
  assert.deepStrictEqual(h.sent.slice(before).map((s) => s.text), [
    'Leider konnten wir deine Zahlung nicht bestätigen. Bitte schick uns einen gültigen Überweisungsbeleg.',
  ]);
  assert.strictEqual(h.customers.get(jid).stage, 'awaiting_screenshot');
  assert.match((await h.say(h.imageMsg(jid, await img(5))))[0], /^Zahlung bestätigt ✅/);
});

test('verified without a configured group link: no empty link is sent', async () => {
  const queue = [goodReceipt(90)];
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  require('../src/config').getCoaching('MAIN').groupLink = '';
  const jid = h.phoneJid(11);
  await h.say(h.textMsg(jid, 'main'));
  assert.deepStrictEqual(await h.say(h.imageMsg(jid, await img(6))), ['Zahlung bestätigt ✅ Den Link zur Coaching-Gruppe bekommst du in Kürze.']);
});

test('PDF receipts (sent as document) are accepted', async () => {
  const queue = [goodReceipt(75)];
  const h = await createHarness({ receipts: { next: (kind) => (assert.strictEqual(kind, 'pdf'), queue.shift()) } });
  require('../src/config').getCoaching('C1').groupLink = 'https://chat.whatsapp.com/TEST-SPORT';
  const jid = h.phoneJid(12);
  await h.say(h.textMsg(jid, 'sport'));
  assert.match((await h.say(h.pdfMsg(jid, Buffer.from('%PDF-1.4 test'))))[0], /^Zahlung bestätigt/);
});

test('same person via LID and phone JID stays one customer', async () => {
  const h = await createHarness();
  const lid = '150375495651422@lid';
  await h.say(h.textMsg(lid, 'Hallo'));
  await h.say(h.textMsg(lid, 'Sport', { key: { remoteJidAlt: h.phoneJid(13) } }));
  assert.strictEqual(h.customers.all().length, 1);
  const c = h.customers.all()[0];
  assert.strictEqual(c.phone, '+491700000013');
  assert.strictEqual(c.stage, 'awaiting_screenshot');
  assert.strictEqual(c.replyJid, lid);
});

test('chat history is recorded both ways', async () => {
  const h = await createHarness();
  const jid = h.phoneJid(14);
  await h.say(h.textMsg(jid, 'Hallo'));
  const chat = h.customers.chatHistory(jid);
  assert.deepStrictEqual(chat.map((m) => m.direction), ['in', 'out']);
});

test('if OpenAI fails, the receipt goes to review (never lost, never rejected)', async () => {
  const h = await createHarness({ receipts: { next: () => { throw new Error('OpenAI down'); } } });
  const jid = h.phoneJid(15);
  await h.say(h.textMsg(jid, 'Sport'));
  assert.deepStrictEqual(await h.say(h.imageMsg(jid, await img(9))), ['Danke! Deine Zahlung wird kurz geprüft. Du bekommst gleich Bescheid.']);
  const [p] = h.payments.all();
  assert.strictEqual(p.status, 'NEEDS_REVIEW');
  assert.match(p.reasons[0], /^Beleg konnte nicht automatisch gelesen werden/);
  assert.ok(p.screenshotFileId, 'screenshot still stored');
});

test('admin decisions are refused while WhatsApp is disconnected (customer must always be told)', async () => {
  const queue = [goodReceipt(1)];
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  const jid = h.phoneJid(16);
  await h.say(h.textMsg(jid, 'Sport'));
  await h.say(h.imageMsg(jid, await img(10)));
  const [p] = h.payments.all();
  h.setConnected(false);
  await assert.rejects(h.conversation.approvePayment(p.id), /WhatsApp ist nicht verbunden/);
  await assert.rejects(h.conversation.rejectPayment(p.id), /WhatsApp ist nicht verbunden/);
  assert.strictEqual(h.payments.get(p.id).status, 'NEEDS_REVIEW');
});

test('bot language switch: English replies, setting stored', async () => {
  const h = await createHarness();
  const settings = require('../src/settings');
  settings.set('botLanguage', 'en');
  const jid = h.phoneJid(17);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Hello')), ['Welcome! Which coaching are you interested in?']);
  assert.strictEqual(h.aiCalls.classify, 0, 'English greeting must not call the AI');
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'I want the money coaching')), [
    'The Money Coaching costs 80 €. Please transfer to:\nRecipient: Ilyas Lang\nIBAN: DE85 5505 0120 1200 6021 16\nReference: Your name + Money Coaching\nThen send me a screenshot of your transfer.',
  ]);
  assert.strictEqual(h.db.get('settings', 'botLanguage').value, '"en"');
  assert.throws(() => settings.set('botLanguage', 'fr'), /Ungültiger Wert/);
  settings.set('botLanguage', 'de');
  assert.match((await h.say(h.textMsg(jid, 'ok')))[0], /^Das Money Coaching kostet 80 €/); // greeting/ack → details again
});

test('German and English texts cover the same messages', () => {
  const { TEXTS } = require('../src/messages');
  assert.deepStrictEqual(Object.keys(TEXTS.en).sort(), Object.keys(TEXTS.de).sort());
});

test('mid-payment: "Hi" repeats the details, "I want to change group" asks again (real chat from testing)', async () => {
  const h = await createHarness();
  require('../src/settings').set('botLanguage', 'en');
  const jid = h.phoneJid(18);
  await h.say(h.textMsg(jid, 'Sport'));
  assert.match((await h.say(h.textMsg(jid, 'Hi')))[0], /^The Sport Coaching costs 75 €\. Please transfer to:/);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'I want to change group')), ['No problem! Which coaching are you interested in?']);
  assert.strictEqual(h.customers.get(jid).stage, 'ask_coaching');
  assert.match((await h.say(h.textMsg(jid, 'money')))[0], /^The Money Coaching costs 80 €/);
  assert.match((await h.say(h.textMsg(jid, 'when?')))[0], /^You chose the Money Coaching \(80 €\)\./);
});

test('verified customer: same link again, change request offers another coaching, naming one starts a new purchase', async () => {
  const queue = [goodReceipt(75)];
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  require('../src/config').getCoaching('C1').groupLink = 'https://chat.whatsapp.com/TEST-SPORT';
  const jid = h.phoneJid(19);
  await h.say(h.textMsg(jid, 'Sport'));
  await h.say(h.imageMsg(jid, await img(20)));
  assert.match((await h.say(h.textMsg(jid, 'I want to change group')))[0], /^Du bist bereits für das Sport Coaching freigeschaltet ✅ Hier ist dein Link: https:\/\/chat\.whatsapp\.com\/TEST-SPORT\nMöchtest du zusätzlich/);
  assert.match((await h.say(h.textMsg(jid, 'Money bitte')))[0], /^Das Money Coaching kostet 80 €/);
  assert.strictEqual(h.customers.get(jid).stage, 'awaiting_screenshot');
});
