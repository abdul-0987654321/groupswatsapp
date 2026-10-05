'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const ai = require('../src/ai');
const { readReceipt } = require('../src/receipt-reader');

function fakeClient(answer, seen) {
  return { chat: { completions: { create: async (req) => { seen.push(req); return { choices: [{ message: { content: JSON.stringify(answer) } }] }; } } } };
}

test('sends images as JPEG with strict JSON schema, normalizes amount', async () => {
  const seen = [];
  ai.setClient(fakeClient({ isPaymentReceipt: true, amount: -90, currency: 'EUR', recipientName: 'ILYAS LANG', recipientIban: null, date: 'Today', time: '16:31', senderName: null, reference: 'x', bankApp: 'Revolut' }, seen));
  const png = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#123456' } }).png().toBuffer();
  const out = await readReceipt(png, 'image/png');
  assert.strictEqual(out.amount, 90);
  assert.strictEqual(seen[0].model, 'gpt-4o-mini');
  assert.strictEqual(seen[0].response_format.json_schema.strict, true);
  assert.match(seen[0].messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test('sends PDFs as file input; missing fields become null', async () => {
  const seen = [];
  ai.setClient(fakeClient({ isPaymentReceipt: true, amount: '5,00' }, seen));
  const out = await readReceipt(Buffer.from('%PDF-1.4'), 'application/pdf');
  assert.strictEqual(seen[0].messages[1].content[1].type, 'file');
  assert.strictEqual(out.amount, 5);
  assert.strictEqual(out.recipientIban, null);
  assert.strictEqual(out.bankApp, null);
});

test('without OPENAI_API_KEY the reader fails clearly (receipt then goes to review)', async () => {
  ai.setClient(null);
  await assert.rejects(readReceipt(Buffer.from('x'), 'image/png'), /OPENAI_API_KEY/);
});
