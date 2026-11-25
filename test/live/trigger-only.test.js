'use strict';
/**
 * Runs against the REAL config/ files, where every package sits behind the "812" menu and
 * nothing is reachable by name. In that setup the bot must keep out of ordinary chats:
 * no reply, and no read receipt, so the owner still sees the message as unread on his phone.
 *
 * The rest of the suite uses test/fixtures/, which has keyword coachings, so this behaviour
 * can only be tested here. Run by `npm test` as a second pass.
 */
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { createHarness } = require('../helpers/harness');
const { detectableCoachings } = require('../../src/config');

assert.strictEqual(detectableCoachings.length, 0,
  'this file must run against the real menu-only config, not the fixtures');

const receipt = (amount) => ({
  isPaymentReceipt: true, recipientName: 'Ilyas Lang', recipientIban: require('../../src/config').BANK.account,
  amount, currency: 'EUR', date: 'Heute', time: null, senderName: 'Max Muster',
  reference: 'Chemie Packet 2', bankApp: 'Sparkasse',
});
const img = async (seed) => {
  let x = seed * 2654435761;
  const px = Buffer.alloc(60 * 120 * 3).map(() => ((x = (x * 1103515245 + 12345) >>> 0) >>> 16) & 255);
  return sharp(px, { raw: { width: 60, height: 120, channels: 3 } }).png().toBuffer();
};
const harness = () => createHarness({ receipts: { next: () => receipt(100) } });

const OFF_TOPIC = [
  'Hallo, bist du der Ilyas vom Fußball?',
  'Hey, hast du morgen Zeit?',
  'Guten Tag, ich habe eine Frage zu etwas anderem',
  'Danke dir!',
  'Wann hast du wieder auf?',
];

test('an unrelated message gets no reply at all', async () => {
  const h = await harness();
  for (const [i, text] of OFF_TOPIC.entries()) {
    const out = await h.say(h.textMsg(h.phoneJid(100 + i), text));
    assert.deepStrictEqual(out, [], `bot replied to: ${text}`);
  }
});

test('an unrelated message is left UNREAD so the owner sees it', async () => {
  const h = await harness();
  const jid = h.phoneJid(1);
  await h.say(h.textMsg(jid, 'Hallo, ich hätte eine Frage'));
  assert.deepStrictEqual(h.readChats, [], 'the chat must not be marked as read');
});

test('a chat the bot does answer is marked read', async () => {
  const h = await harness();
  const jid = h.phoneJid(2);
  await h.say(h.textMsg(jid, '812'));
  assert.deepStrictEqual(h.readChats, [jid], 'the booking chat should be marked read');
});

test('unanswered messages are still logged, so the owner sees them in the dashboard', async () => {
  const h = await harness();
  const jid = h.phoneJid(3);
  await h.say(h.textMsg(jid, 'Hallo, ganz andere Sache'));
  const chat = h.db.all('chat').filter((c) => c.jid === jid);
  assert.strictEqual(chat.length, 1, 'the message must still appear under Chats');
  assert.strictEqual(chat[0].direction, 'in');
  assert.strictEqual(chat[0].text, 'Hallo, ganz andere Sache');
});

test('a photo sent out of the blue is stored but not answered or read', async () => {
  const h = await harness();
  const jid = h.phoneJid(4);
  const out = await h.say(h.imageMsg(jid, await img(1)));
  assert.deepStrictEqual(out, [], 'a random photo must not start a payment check');
  assert.deepStrictEqual(h.readChats, []);
  assert.strictEqual(h.payments.forCustomer(jid).length, 0, 'no receipt should be read');
  assert.strictEqual(h.aiCalls.receipt, 0, 'no OpenAI call for an unsolicited photo');
});

test('once the code is sent, the whole booking is answered normally', async () => {
  const h = await harness();
  const jid = h.phoneJid(5);
  assert.ok((await h.say(h.textMsg(jid, '812')))[0].includes('welches Paket'));
  assert.ok((await h.say(h.textMsg(jid, '2')))[0].includes('IBAN'));
  // mid-booking the bot answers even an unclear message
  assert.ok((await h.say(h.textMsg(jid, 'wie lange dauert das?'))).length > 0);
  const [done] = await h.say(h.imageMsg(jid, await img(2)));
  assert.ok(done.includes('chat.whatsapp.com'), 'booking should complete');
});

test('after the booking is finished the bot goes quiet again', async () => {
  const h = await harness();
  const jid = h.phoneJid(6);
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, '2'));
  await h.say(h.imageMsg(jid, await img(3)));
  const before = h.readChats.length;

  assert.deepStrictEqual(await h.say(h.textMsg(jid, 'Hey, noch eine Frage zu was anderem')), [],
    'a finished customer should not keep getting bot replies');
  assert.strictEqual(h.readChats.length, before, 'and that message stays unread');
});

test('a finished customer gets their link back by sending the code again', async () => {
  const h = await harness();
  const jid = h.phoneJid(7);
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, '2'));
  await h.say(h.imageMsg(jid, await img(4)));

  await h.say(h.textMsg(jid, '812'));
  const [again] = await h.say(h.textMsg(jid, '2'));
  assert.ok(again.includes('chat.whatsapp.com'), 'should hand back the existing link');
  assert.strictEqual(h.payments.forCustomer(jid).length, 1, 'and not create a second payment');
});

test('a customer waiting for a review still gets answered', async () => {
  const h = await createHarness({ receipts: { next: () => receipt(7) } }); // wrong amount → review
  const jid = h.phoneJid(8);
  await h.say(h.textMsg(jid, '812'));
  await h.say(h.textMsg(jid, '2'));
  await h.say(h.imageMsg(jid, await img(5)));
  assert.ok((await h.say(h.textMsg(jid, 'und jetzt?'))).length > 0, 'must not be left hanging mid-review');
});

test('a paused bot answers nobody and reads nothing, even with the code', async () => {
  const h = await harness();
  require('../../src/settings').set('botEnabled', false);
  const jid = h.phoneJid(9);
  assert.deepStrictEqual(await h.say(h.textMsg(jid, '812')), []);
  assert.deepStrictEqual(h.readChats, []);
  require('../../src/settings').set('botEnabled', true);
});
