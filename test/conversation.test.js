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
  date: 'Heute', time: null, senderName: 'Max Muster', reference: 'Max Muster Coaching', bankApp: 'Sparkasse', ...extra,
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
  // AI guess → confirm first, price only after "ja"
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'ich möchte besser Englisch reden können')), ['Meinst du das Lang Coaching? Antworte bitte mit Ja oder Nein.']);
  assert.match((await h.say(h.textMsg(jid, 'ja genau')))[0], /^Das Lang Coaching kostet 85 €/);

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
    'Du bist bereits für das Sport Coaching freigeschaltet ✅ Hier ist dein Link zur Coaching-Gruppe: https://chat.whatsapp.com/TEST-SPORT\n' +
      'Möchtest du ein weiteres Coaching? Schreib mir einfach, welches.',
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

test('verified customer: "Hi" → link again; "new group" → asks which coaching → new purchase; owned coaching → link, not a second payment', async () => {
  const queue = [goodReceipt(75), goodReceipt(80, { reference: 'zweites' })];
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  const config = require('../src/config');
  config.getCoaching('C1').groupLink = 'https://chat.whatsapp.com/TEST-SPORT';
  config.getCoaching('C2').groupLink = 'https://chat.whatsapp.com/TEST-MONEY';
  require('../src/settings').set('botLanguage', 'en');
  const jid = h.phoneJid(19);
  await h.say(h.textMsg(jid, 'Sport'));
  await h.say(h.imageMsg(jid, await img(20)));
  // the real chat from testing
  assert.match((await h.say(h.textMsg(jid, 'Hi')))[0], /^You are already unlocked for the Sport Coaching ✅ .*TEST-SPORT\nWould you like another coaching\?/);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'i want to join a new group')), ['Sure! Which other coaching are you interested in? (Your current group link stays valid.)']);
  // naming the coaching they already own → that link again, no second payment
  assert.match((await h.say(h.textMsg(jid, 'sport')))[0], /^You are already unlocked for the Sport Coaching/);
  assert.strictEqual(h.customers.get(jid).stage, 'verified');
  // a different coaching → new purchase, then both links work
  await h.say(h.textMsg(jid, 'another one please'));
  assert.match((await h.say(h.textMsg(jid, 'money')))[0], /^The Money Coaching costs 80 €/);
  assert.match((await h.say(h.imageMsg(jid, await img(21))))[0], /^Payment confirmed ✅ .*TEST-MONEY/);
  assert.match((await h.say(h.textMsg(jid, 'sport link?')))[0], /TEST-SPORT/);
  assert.match((await h.say(h.textMsg(jid, 'money link?')))[0], /TEST-MONEY/);
});

test('admin alerts: review and auto-verified payments are reported to the admin number', async () => {
  const queue = [goodReceipt(70), goodReceipt(80)];
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  require('../src/config').getCoaching('C2').groupLink = 'https://chat.whatsapp.com/TEST-MONEY';
  const settings = require('../src/settings');
  assert.deepStrictEqual(settings.set('adminNumbers', '+49 170 999 8888, 0092 300 1112223'), ['491709998888', '923001112223']);
  assert.throws(() => settings.set('adminNumbers', '0170 123'), /Ländervorwahl/);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const admin = (s) => s.jid === '491709998888@s.whatsapp.net';

  const jid = h.phoneJid(30);
  await h.say(h.textMsg(jid, 'Money'));
  await h.say(h.imageMsg(jid, await img(30)));
  await tick();
  const reviewAlert = h.sent.filter(admin).map((s) => s.text);
  assert.strictEqual(reviewAlert.length, 1);
  assert.match(reviewAlert[0], /^⚠️ Neue Zahlung zur Prüfung\nKunde: Max Muster – \+491700000030\nCoaching: Money Coaching \(80 €\)\nBetrag laut Beleg: 70 €\nZahlung: Z-\d+\nGründe: Falscher Betrag/);
  assert.strictEqual(h.sent.filter((s) => s.jid === '923001112223@s.whatsapp.net').length, 1, 'all admin numbers get it');

  const jid2 = h.phoneJid(31);
  await h.say(h.textMsg(jid2, 'Money'));
  await h.say(h.imageMsg(jid2, await img(31)));
  await tick();
  const all = h.sent.filter(admin).map((s) => s.text);
  assert.match(all[1], /^✅ Zahlung bestätigt – Gruppenlink gesendet\nKunde: Max Muster – \+491700000031\nCoaching: Money Coaching \(80 €\)/);

  settings.set('alertOnVerified', false);
  const jid3 = h.phoneJid(32);
  queue.push(goodReceipt(80, { reference: 'other' }));
  await h.say(h.textMsg(jid3, 'Money'));
  await h.say(h.imageMsg(jid3, await img(32)));
  await tick();
  assert.strictEqual(h.sent.filter(admin).length, 2, 'verified alerts can be switched off');
});

test('messages from an admin number are not treated as a customer', async () => {
  const h = await createHarness();
  require('../src/settings').set('adminNumbers', ['491709998888']);
  assert.deepStrictEqual(await h.say(h.textMsg('491709998888@s.whatsapp.net', 'ok danke')), []);
  assert.strictEqual(h.customers.all().length, 0);
});

test('images sent outside the payment step are saved for the dashboard chat', async () => {
  const h = await createHarness();
  const jid = h.phoneJid(33);
  await h.say(h.imageMsg(jid, await img(33), { caption: 'Hallo' }));
  await new Promise((r) => setTimeout(r, 50));
  const [entry] = h.customers.chatHistory(jid);
  assert.strictEqual(entry.text, '[Bild] Hallo');
  assert.ok(entry.fileId, 'file stored');
  const file = await h.backend.getFile(entry.fileId);
  assert.ok(file.buffer.length > 0);
});

test('receipt chat entries link to the screenshot and the payment', async () => {
  const queue = [goodReceipt(75)];
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  const jid = h.phoneJid(34);
  await h.say(h.textMsg(jid, 'Sport'));
  await h.say(h.imageMsg(jid, await img(34)));
  const entry = h.customers.chatHistory(jid).find((m) => m.text.startsWith('[Bild]'));
  const [p] = h.payments.all();
  assert.strictEqual(entry.paymentId, p.id);
  assert.strictEqual(entry.fileId, p.screenshotFileId);
});

test('deleting a customer lets the same number start fresh (and reuse its screenshot)', async () => {
  const queue = [goodReceipt(75), goodReceipt(75)];
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  require('../src/config').getCoaching('C1').groupLink = 'https://chat.whatsapp.com/TEST-SPORT';
  const jid = h.phoneJid(40);
  const shot = await img(40);
  await h.say(h.textMsg(jid, 'Sport'));
  await h.say(h.imageMsg(jid, shot));
  assert.strictEqual(h.customers.get(jid).stage, 'verified');
  const removed = h.customers.deleteCustomer(jid);
  assert.deepStrictEqual({ ...removed, chat: removed.chat > 0 }, { customer: true, chat: true, payments: 1 });
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Hallo')), ['Willkommen! Für welches Coaching interessierst du dich?']);
  await h.say(h.textMsg(jid, 'Sport'));
  assert.match((await h.say(h.imageMsg(jid, shot)))[0], /^Zahlung bestätigt ✅/, 'no duplicate after reset');
});

test('bot paused: messages are saved but nobody gets a reply; switching on resumes', async () => {
  const h = await createHarness();
  const settings = require('../src/settings');
  settings.set('botEnabled', false);
  const jid = h.phoneJid(50);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Hallo')), []);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Sport')), []);
  assert.deepStrictEqual(h.customers.chatHistory(jid).map((m) => m.text), ['Hallo', 'Sport']);
  settings.set('botEnabled', true);
  assert.match((await h.say(h.textMsg(jid, 'Sport')))[0], /^Das Sport Coaching kostet/);
});

test('paid customer chat from testing: Hi → link, "I need new group"/"Yes need it" → asks which, thanks → polite, AI understands free text', async () => {
  let aiAnswer = 'UNKNOWN';
  const queue = [goodReceipt(80)];
  const h = await createHarness({ classify: () => aiAnswer, receipts: { next: () => queue.shift() } });
  const config = require('../src/config');
  config.getCoaching('C2').groupLink = 'https://chat.whatsapp.com/TEST-MONEY';
  require('../src/settings').set('botLanguage', 'en');
  const jid = h.phoneJid(60);
  await h.say(h.textMsg(jid, 'money'));
  await h.say(h.imageMsg(jid, await img(60)));
  const ASK = ['Sure! Which other coaching are you interested in? (Your current group link stays valid.)'];
  const reset = () => { const c = h.customers.get(jid); c.stage = 'verified'; h.customers.save(c); };

  assert.match((await h.say(h.textMsg(jid, 'Hi')))[0], /^You are already unlocked for the Money Coaching/);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'I need new group')), ASK); reset();
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Yes')), ASK); reset();
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Yes need it')), ASK); reset();
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'haan ji')), ASK); reset();
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'ok thanks')), ["You're welcome! 😊 If you need anything else, just write me."]);
  const before = h.aiCalls.classify;
  aiAnswer = 'NEW';
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'mujhe aik aur join karna hai')), ASK); reset();
  aiAnswer = 'C1';
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'the fitness one')), ['Do you mean the Sport Coaching? Please answer Yes or No.']);
  assert.match((await h.say(h.textMsg(jid, 'yes')))[0], /^The Sport Coaching costs 75 €/); reset();
  aiAnswer = 'LINK';
  assert.match((await h.say(h.textMsg(jid, 'the link does not open')))[0], /TEST-MONEY/);
  aiAnswer = 'Sure, here is the IBAN DE00…'; // AI tries to write text → ignored, link again
  assert.match((await h.say(h.textMsg(jid, 'blabla')))[0], /TEST-MONEY/);
  assert.strictEqual(h.aiCalls.classify - before, 4, 'AI only for free text, not for rule matches');
});

test('unknown coachings ("mango", "Malaysia") get a "not offered" reply; vague messages get varied questions, never a list', async () => {
  const answers = { 'I am interested ina mango': 'NOT_OFFERED', 'I am interested in Malaysia': 'NOT_OFFERED' };
  const h = await createHarness({ classify: (t) => answers[t] || 'UNKNOWN' });
  require('../src/settings').set('botLanguage', 'en');
  const jid = h.phoneJid(70);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Hi')), ['Welcome! Which coaching are you interested in?']);
  const notOffered = ["Sorry, we don't offer that coaching. 🙏 Please tell me the name of the coaching you are interested in."];
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'I am interested ina mango')), notOffered);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'I am interested in Malaysia')), notOffered);
  const vague = [];
  for (const t of ['what do you have', 'tell me more', 'what else', 'hmm']) vague.push((await h.say(h.textMsg(jid, t)))[0]);
  assert.ok(new Set(vague).size >= 3, 'questions vary: ' + vague.join(' | '));
  assertNoList(h.sent);
  assert.match((await h.say(h.textMsg(jid, 'sport')))[0], /^The Sport Coaching costs/);
});

test('payment and customer numbers are never reused after "Delete chat" (old screenshots must not reappear)', async () => {
  const queue = [goodReceipt(75), goodReceipt(75, { reference: 'b' })];
  const h = await createHarness({ receipts: { next: () => queue.shift() } });
  const jid = h.phoneJid(80);
  await h.say(h.textMsg(jid, 'Sport'));
  await h.say(h.imageMsg(jid, await img(80)));
  const first = h.payments.all()[0];
  const firstCustomer = h.customers.get(jid).id;
  h.customers.deleteCustomer(jid);
  await h.say(h.textMsg(jid, 'Sport'));
  await h.say(h.imageMsg(jid, await img(81)));
  const second = h.payments.all()[0];
  assert.notStrictEqual(second.id, first.id);
  assert.notStrictEqual(h.customers.get(jid).id, firstCustomer);
  assert.ok(h.customers.get(jid).priceSentAt, 'bot remembers when it sent the bank details');
});

test('"I need Malayalam": AI guesses are confirmed first; "no" → asks again; another message is handled normally', async () => {
  let aiAnswer = 'C3'; // AI thinks "Malayalam is a language → Lang Coaching"
  const h = await createHarness({ classify: () => aiAnswer });
  require('../src/settings').set('botLanguage', 'en');
  const jid = h.phoneJid(90);
  await h.say(h.textMsg(jid, 'Hi'));
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'I need Malayalam')), ['Do you mean the Lang Coaching? Please answer Yes or No.']);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'no')), ['Alright! Which coaching are you interested in then?']);
  assert.strictEqual(h.customers.get(jid).stage, 'ask_coaching');
  // asked again, customer types something else instead of yes/no → normal detection
  await h.say(h.textMsg(jid, 'I need Malayalam'));
  assert.match((await h.say(h.textMsg(jid, 'money')))[0], /^The Money Coaching costs 80 €/);
  // keyword matches never need a confirmation
  const jid2 = h.phoneJid(91);
  assert.match((await h.say(h.textMsg(jid2, 'language coaching')))[0], /^The Lang Coaching costs 85 €/);
  // "not offered" from the AI
  aiAnswer = 'NOT_OFFERED';
  const jid3 = h.phoneJid(92);
  await h.say(h.textMsg(jid3, 'Hi'));
  assert.deepStrictEqual(await h.say(h.textMsg(jid3, 'I need Malayalam')), ["Sorry, we don't offer that coaching. 🙏 Please tell me the name of the coaching you are interested in."]);
  assertNoList(h.sent);
});
