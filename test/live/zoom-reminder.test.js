'use strict';
/**
 * The Zoom reminder for the Probestunde. Runs against the real config/, where CHEM_PROBE is
 * the one package carrying a "reminder" text.
 */
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { createHarness } = require('../helpers/harness');
const { BANK } = require('../../src/config');

// NOTE: the harness clears the /src/ require cache, so settings and the reminder must be
// taken from the harness (h.settings, h.zoom) — a module required here would be a stale copy.
const { instantFromLocal } = require('../../src/zoom-reminder'); // pure helper, safe to use

const LINK = 'https://us06web.zoom.us/j/85307148430?pwd=abc.1';
const MEETING = '2026-11-24T19:30';              // local wall time, Europe/Berlin
const STARTS = instantFromLocal(MEETING);        // 18:30 UTC
const at = (msFromStart) => new Date(STARTS.getTime() + msFromStart);
const MIN = 60 * 1000;

// Each booker needs their own name: three identical 5 € transfers on one day would
// (correctly) be flagged as duplicates and never reach VERIFIED.
const NAMES = ['Max Muster', 'Anna Weber', 'Ben Klein', 'Clara Fuchs', 'Tim Vogel', 'Lea Berg'];
const receipt = (amount, who = 'Max Muster') => ({
  isPaymentReceipt: true, recipientName: 'Ilyas Lang', recipientIban: BANK.account, amount,
  currency: 'EUR', date: 'Heute', time: null, senderName: who,
  reference: `${who} Chemie`, bankApp: 'Sparkasse',
});
const img = async (seed) => {
  let x = seed * 2654435761;
  const px = Buffer.alloc(60 * 120 * 3).map(() => ((x = (x * 1103515245 + 12345) >>> 0) >>> 16) & 255);
  return sharp(px, { raw: { width: 60, height: 120, channels: 3 } }).png().toBuffer();
};

/** A harness with `n` Probestunde bookers (option 1) and optionally a Komplettpaket one. */
async function withBookers(n, { komplett = false } = {}) {
  const queue = [];
  for (let i = 0; i < n; i++) queue.push([5, NAMES[i % NAMES.length]]);
  if (komplett) queue.push([100, 'Komplett Kunde']);
  const h = await createHarness({ receipts: { next: () => receipt(...(queue.shift() || [5, 'Spät Bucher'])) } });
  h.settings.set('zoomLink', LINK);
  h.settings.set('zoomMeetingAt', MEETING);
  const jids = [];
  for (let i = 0; i < n; i++) {
    const jid = h.phoneJid(i + 1);
    await h.say(h.textMsg(jid, '812'));
    await h.say(h.textMsg(jid, '1'));
    await h.say(h.imageMsg(jid, await img(i + 1)));
    jids.push(jid);
  }
  if (komplett) {
    const jid = h.phoneJid(90);
    await h.say(h.textMsg(jid, '812'));
    await h.say(h.textMsg(jid, '2'));
    await h.say(h.imageMsg(jid, await img(90)));
    jids.push(jid);
  }
  h.sent.length = 0; // forget the booking messages
  return { h, jids };
}

test('only CHEM_PROBE carries a reminder text', async () => {
  const { h } = await withBookers(0);
  assert.deepStrictEqual(h.zoom.reminderPackageIds(), ['CHEM_PROBE']);
});

test('nothing is sent earlier than one hour before', async () => {
  const { h } = await withBookers(2);
  const r = await h.zoom.run({ now: at(-61 * MIN) });
  assert.strictEqual(r.sent, 0);
  assert.deepStrictEqual(h.sent, []);
});

test('one hour before, every Probestunde booker gets the link', async () => {
  const { h, jids } = await withBookers(3);
  const r = await h.zoom.run({ now: at(-60 * MIN) });
  assert.strictEqual(r.sent, 3);
  assert.deepStrictEqual(h.sent.map((s) => s.jid).sort(), [...jids].sort());
  for (const s of h.sent) {
    assert.ok(s.text.includes(LINK), 'the Zoom link must be in the message');
    assert.ok(s.text.includes('19:30'), `the local start time should be shown: ${s.text}`);
  }
});

test('a Komplettpaket customer is not sent the Zoom link', async () => {
  const { h, jids } = await withBookers(1, { komplett: true });
  await h.zoom.run({ now: at(-30 * MIN) });
  assert.deepStrictEqual(h.sent.map((s) => s.jid), [jids[0]], 'only the Probestunde booker');
});

test('running again does not send the link twice', async () => {
  const { h } = await withBookers(2);
  await h.zoom.run({ now: at(-60 * MIN) });
  const afterFirst = h.sent.length;
  await h.zoom.run({ now: at(-45 * MIN) });
  await h.zoom.run({ now: at(-5 * MIN) });
  assert.strictEqual(h.sent.length, afterFirst, 'the same meeting must only be sent once per customer');
});

test('someone who books inside the window still gets it on the next run', async () => {
  const { h } = await withBookers(1);
  await h.zoom.run({ now: at(-50 * MIN) });
  assert.strictEqual(h.sent.length, 1);

  h.receipts.next = () => receipt(5, 'Spät Bucher');
  const late = h.phoneJid(42);
  await h.say(h.textMsg(late, '812'));
  await h.say(h.textMsg(late, '1'));
  await h.say(h.imageMsg(late, await img(42)));
  h.sent.length = 0;

  const r = await h.zoom.run({ now: at(-20 * MIN) });
  assert.strictEqual(r.sent, 1, 'the late booker should still get the link');
  assert.strictEqual(h.sent[0].jid, late);
});

test('a new meeting time sends to everyone again', async () => {
  const { h } = await withBookers(2);
  await h.zoom.run({ now: at(-60 * MIN) });
  h.sent.length = 0;

  const NEXT = '2026-12-01T19:30';
  h.settings.set('zoomMeetingAt', NEXT);
  const r = await h.zoom.run({ now: new Date(instantFromLocal(NEXT).getTime() - 60 * MIN) });
  assert.strictEqual(r.sent, 2, 'a new meeting means everyone is due again');
});

test('a meeting long past is not sent at all', async () => {
  const { h } = await withBookers(2);
  const r = await h.zoom.run({ now: at(+120 * MIN) });
  assert.strictEqual(r.sent, 0);
  assert.match(r.reason, /Vergangenheit/);
  assert.deepStrictEqual(h.sent, []);
});

test('no link or no date configured → nothing happens', async () => {
  const { h } = await withBookers(1);
  h.settings.set('zoomLink', '');
  assert.strictEqual((await h.zoom.run({ now: at(-30 * MIN) })).sent, 0);
  h.settings.set('zoomLink', LINK);
  h.settings.set('zoomMeetingAt', '');
  assert.strictEqual((await h.zoom.run({ now: at(-30 * MIN) })).sent, 0);
  assert.deepStrictEqual(h.sent, []);
});

test('"send now" ignores the one-hour window', async () => {
  const { h } = await withBookers(2);
  const r = await h.zoom.run({ force: true, now: at(-5 * 60 * MIN) });
  assert.strictEqual(r.sent, 2, 'the manual button should send regardless of timing');
  assert.ok(h.sent.every((s) => s.text.includes(LINK)));
});

test('a customer who cannot be reached is retried on the next run', async () => {
  const { h } = await withBookers(1);
  h.setConnected(false);
  const first = await h.zoom.run({ now: at(-55 * MIN) });
  assert.strictEqual(first.sent, 0);
  assert.strictEqual(first.failed.length, 1);

  h.setConnected(true);
  const second = await h.zoom.run({ now: at(-50 * MIN) });
  assert.strictEqual(second.sent, 1, 'a failed send must not be recorded as delivered');
});

test('the reminder is logged to the chat history', async () => {
  const { h, jids } = await withBookers(1);
  await h.zoom.run({ now: at(-30 * MIN) });
  const out = h.db.all('chat').filter((c) => c.jid === jids[0] && c.direction === 'out');
  assert.ok(out.some((c) => c.text.includes(LINK)), 'the sent link should appear under Chats');
});
