'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { verify, resolveDate, ibanMatches, nameMatches, senderFromReference } = require('../src/verify');
const { getCoaching } = require('../src/config');

const MAIN = getCoaching('MAIN');
const RECEIVED = '2026-10-05T16:35:00+02:00';
const base = {
  isPaymentReceipt: true, recipientName: 'Ilyas Lang', recipientIban: 'DE85 5505 0120 1200 6021 16', amount: 90, currency: 'EUR',
  date: '2026-10-05', time: '16:31', senderName: 'Max Muster', reference: 'Package 4, MAX MUSTER', bankApp: 'Sparkasse',
};
const run = (over, ctx = {}) => verify({ ...base, ...over }, { coaching: MAIN, receivedAt: RECEIVED, previousPayments: [], ...ctx });

test('all checks pass → VERIFIED', () => {
  const r = run({});
  assert.strictEqual(r.status, 'VERIFIED');
  assert.deepStrictEqual(r.reasons, []);
});

test('recipient: IBAN with/without spaces, masked IBAN, or name in any order/case', () => {
  assert.strictEqual(ibanMatches('DE85550501201200602116'), true);
  assert.strictEqual(ibanMatches('de85 5505 0120 1200 6021 16'), true);
  assert.strictEqual(ibanMatches('DE85 **** **** **** 6021 16'), true);
  assert.strictEqual(ibanMatches('DE85 •••• 6021 16'), true);
  assert.strictEqual(ibanMatches('DE12 **** **** **** 6021 16'), false);
  assert.strictEqual(nameMatches('ILYAS LANG'), true);
  assert.strictEqual(nameMatches('Lang, Ilyas'), true);
  assert.strictEqual(nameMatches('Ilyas'), false);
  assert.strictEqual(run({ recipientIban: null }).status, 'VERIFIED'); // Revolut shows only the name
  assert.strictEqual(run({ recipientName: null }).status, 'VERIFIED'); // IBAN alone is enough
});

test('recipient wrong → NEEDS_REVIEW; a fully readable foreign IBAN fails even with the right name', () => {
  assert.deepStrictEqual(run({ recipientName: 'Max Mustermann', recipientIban: null }).reasons, ['Empfänger stimmt nicht (Max Mustermann)']);
  assert.deepStrictEqual(run({ recipientIban: 'DE02 1203 0000 0000 2020 51' }).reasons, ['Empfänger-IBAN stimmt nicht (DE02 1203 0000 0000 2020 51)']);
  assert.deepStrictEqual(run({ recipientName: null, recipientIban: null }).reasons, ['Empfänger nicht erkennbar']);
});

test('amount must equal the coaching price in EUR', () => {
  assert.deepStrictEqual(run({ amount: 89.99 }).reasons, ['Falscher Betrag: 89,99 € statt 90,00 €']);
  assert.deepStrictEqual(run({ amount: null }).reasons, ['Betrag nicht erkennbar']);
  assert.deepStrictEqual(run({ currency: 'USD' }).reasons, ['Falsche Währung (USD)']);
  assert.strictEqual(run({ currency: null }).status, 'VERIFIED');
});

test('date formats and relative dates', () => {
  assert.deepStrictEqual(resolveDate('14.01.2026', RECEIVED), { date: '2026-01-14', relative: false });
  assert.deepStrictEqual(resolveDate('03.08.26', RECEIVED), { date: '2026-08-03', relative: false });
  assert.deepStrictEqual(resolveDate('14. Januar 2026', RECEIVED), { date: '2026-01-14', relative: false });
  assert.deepStrictEqual(resolveDate('Jan 14, 2026', RECEIVED), { date: '2026-01-14', relative: false });
  assert.deepStrictEqual(resolveDate('Heute, 16:31', RECEIVED), { date: '2026-10-05', relative: true });
  assert.deepStrictEqual(resolveDate('A few minutes ago', RECEIVED), { date: '2026-10-05', relative: true });
  assert.deepStrictEqual(resolveDate('vor 5 Minuten', RECEIVED), { date: '2026-10-05', relative: true });
  assert.deepStrictEqual(resolveDate('Gestern', RECEIVED), { date: '2026-10-04', relative: true });
  // Berlin time: 23:30 UTC on 4 Oct is already 5 Oct in Germany
  assert.deepStrictEqual(resolveDate('Heute', '2026-10-04T23:30:00Z'), { date: '2026-10-05', relative: true });
  assert.strictEqual(resolveDate('irgendwann', RECEIVED), null);
});

test('date must be within the last 7 days', () => {
  assert.strictEqual(run({ date: '2026-09-28' }).status, 'VERIFIED'); // exactly 7 days
  assert.deepStrictEqual(run({ date: '2026-09-27' }).reasons, ['Zu alt: Zahlung vom 27.09.2026 (8 Tage)']);
  assert.deepStrictEqual(run({ date: '2026-01-14' }).reasons, ['Zu alt: Zahlung vom 14.01.2026 (264 Tage)']);
  assert.deepStrictEqual(run({ date: '2026-10-09' }).reasons, ['Datum liegt in der Zukunft (09.10.2026)']);
  assert.deepStrictEqual(run({ date: null }).reasons, ['Datum nicht erkennbar']);
  assert.strictEqual(run({ date: 'Today' }).status, 'VERIFIED');
});

test('not a receipt → NEEDS_REVIEW (never auto-rejected)', () => {
  const r = run({ isPaymentReceipt: false });
  assert.strictEqual(r.status, 'NEEDS_REVIEW');
  assert.ok(r.reasons.includes('Kein Zahlungsbeleg erkannt'));
});

test('sender name: from receipt, else from the reference text', () => {
  assert.strictEqual(senderFromReference('Package 4, MAX PETER MUSTER'), 'Max Peter Muster');
  assert.strictEqual(senderFromReference('Probetermin, Lena Maier, Biochemie'), 'Lena Maier');
  assert.strictEqual(senderFromReference('Jonas Weber + Biochemie'), 'Jonas Weber');
  assert.strictEqual(senderFromReference('Probetermin Lena Maier Biochemie DATUM 02.08.2026, 17.14 UHR'), 'Lena Maier');
  assert.strictEqual(senderFromReference('Sport Coaching'), null);
  assert.strictEqual(run({ senderName: null }).senderName, 'Max Muster');
  assert.strictEqual(run({ senderName: 'Erika Muster' }).senderName, 'Erika Muster');
});

test('duplicates: same image hash, or same reference + amount + date + sender', () => {
  const prev = { id: 'Z-1001', receivedAt: '2026-10-05T10:00:00Z', imageHash: 'abc', extracted: { ...base }, paymentDate: '2026-10-05', senderName: 'Max Muster' };
  assert.match(run({}, { imageHash: 'abc', previousPayments: [prev] }).reasons[0], /^Duplikat: gleicher Beleg wurde bereits am .* \(Z-1001\)$/);
  assert.strictEqual(run({}, { imageHash: 'zzz', previousPayments: [prev] }).status, 'NEEDS_REVIEW');
  assert.strictEqual(run({ reference: 'Package 5, MAX MUSTER' }, { imageHash: 'zzz', previousPayments: [prev] }).status, 'VERIFIED');
});

test('near-duplicate image (re-compressed) with the same amount is caught', async () => {
  const sharp = require('sharp');
  const { fingerprints } = require('../src/image-hash');
  let x = 7;
  const px = Buffer.alloc(300 * 600 * 3).map(() => ((x = (x * 1103515245 + 12345) >>> 0) >>> 16) & 255);
  const original = await sharp(px, { raw: { width: 300, height: 600, channels: 3 } }).blur(3).png().toBuffer();
  const resent = await sharp(original).resize(200).jpeg({ quality: 60 }).toBuffer();
  const a = await fingerprints(original, 'image/png');
  const b = await fingerprints(resent, 'image/jpeg');
  assert.notStrictEqual(a.imageHash, b.imageHash);
  const prev = { id: 'Z-1001', receivedAt: RECEIVED, ...a, extracted: { ...base } }; // same picture → AI reads the same reference
  assert.match(run({}, { ...b, previousPayments: [prev] }).reasons[0], /^Duplikat/);
  assert.strictEqual(run({ amount: 90, reference: 'y' }, { ...b, previousPayments: [{ ...prev, extracted: { ...base, amount: 75 } }] }).status, 'VERIFIED');
});

test('AI judgement: pending/failed transfer, suspicious receipt or AI says wrong recipient → review', () => {
  assert.deepStrictEqual(run({ transferCompleted: false }).reasons, ['Überweisung nicht abgeschlossen (z. B. ausstehend oder fehlgeschlagen)']);
  assert.deepStrictEqual(run({ suspicious: true, aiNotes: 'Betrag wirkt überklebt.' }).reasons, ['KI-Hinweis: Beleg wirkt verdächtig – Betrag wirkt überklebt.']);
  assert.deepStrictEqual(run({ recipientIsExpected: false, aiNotes: 'Andere Bank.' }).reasons, ['KI: Empfänger passt nicht zum erwarteten Konto – Andere Bank.']);
  assert.strictEqual(run({ transferCompleted: true, recipientIsExpected: true, suspicious: false }).status, 'VERIFIED');
  assert.strictEqual(run({ transferCompleted: null, recipientIsExpected: null }).status, 'VERIFIED', 'unknown is not a failure');
});

test('look-alike receipts from the same bank app are not duplicates when the transaction IDs differ (real case)', () => {
  const thumb = Buffer.alloc(2048, 7).toString('base64'); // identical tiny picture = same app layout
  const prev = { id: 'Z-1003', receivedAt: '2026-10-05T13:25:00Z', imageHash: 'aaa', thumbnail: thumb, paymentDate: '2026-10-05', senderName: 'Saima Arshad',
    extracted: { ...base, reference: '#57001381621', time: '12:53', amount: 90 } };
  const ctx = { imageHash: 'bbb', thumbnail: thumb, previousPayments: [prev] };
  // different transaction ID → not a duplicate
  assert.strictEqual(run({ reference: '#57002986622', time: '13:28', senderName: 'Saima Arshad' }, ctx).status, 'VERIFIED');
  // same ID (even with one misread digit) → duplicate
  assert.match(run({ reference: '#570013816621', time: '12:53' }, ctx).reasons[0], /^Duplikat/);
  // no IDs on either receipt: same date + time → duplicate, different time → not
  const noRef = { ...prev, extracted: { ...prev.extracted, reference: null } };
  assert.match(run({ reference: null, time: '12:53' }, { ...ctx, previousPayments: [noRef] }).reasons[0], /^Duplikat/);
  assert.strictEqual(run({ reference: null, time: '13:28' }, { ...ctx, previousPayments: [noRef] }).status, 'VERIFIED');
  // exactly the same file is always a duplicate
  assert.match(run({ reference: '#57002986622' }, { ...ctx, imageHash: 'aaa' }).reasons[0], /^Duplikat/);
});
