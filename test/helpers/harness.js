'use strict';
/**
 * Test harness: fresh in-memory storage, a fake WhatsApp bot that records what would be
 * sent, and a fake OpenAI client (coaching classification + receipt extraction).
 */

function freshModules() {
  for (const k of Object.keys(require.cache)) if (k.includes('/src/')) delete require.cache[k];
}

async function createHarness({ classify = () => 'UNKNOWN', receipts = {} } = {}) {
  process.env.TYPING_MIN_MS = '0';
  process.env.TYPING_MAX_MS = '0';
  process.env.READ_MIN_MS = '0';
  process.env.READ_MAX_MS = '0';
  freshModules();
  const db = require('../../src/storage/db');
  const { createMemoryBackend } = require('../../src/storage/backend-memory');
  const ai = require('../../src/ai');
  const conversation = require('../../src/conversation');
  const customers = require('../../src/customers');
  const payments = require('../../src/payments');
  const backend = createMemoryBackend();
  await db.init(backend);

  const aiCalls = { classify: 0, receipt: 0 };
  ai.setClient({
    chat: {
      completions: {
        create: async (req) => {
          if (req.response_format?.type === 'json_schema') {
            aiCalls.receipt++;
            const img = req.messages[1].content[1];
            const key = img.type === 'file' ? 'pdf' : 'image';
            // the test passes the receipt id through the harness map, keyed by the call order
            const data = receipts.next ? receipts.next(key) : {};
            return { choices: [{ message: { content: JSON.stringify(data) } }] };
          }
          aiCalls.classify++;
          return { choices: [{ message: { content: classify(req.messages[1].content) } }] };
        },
      },
    },
  });

  const sent = [];
  let connected = true;
  const fakeBot = {
    onMessage() {},
    isConnected: () => connected,
    async sendText(jid, text) {
      if (!connected) throw new Error('WhatsApp ist nicht verbunden');
      sent.push({ jid, text });
    },
    async downloadImage(msg) {
      if (msg._downloadFails) throw new Error('media expired');
      return msg._buffer;
    },
  };
  conversation.attach(fakeBot);

  let seq = 0;
  const phoneJid = (n) => `49170${String(n).padStart(7, '0')}@s.whatsapp.net`;
  function textMsg(from, text, extra = {}) {
    return { key: { remoteJid: from, id: 'M' + ++seq, fromMe: false, ...extra.key }, pushName: extra.pushName || 'Kunde', messageTimestamp: Math.floor((extra.at || Date.now()) / 1000), message: { conversation: text } };
  }
  function imageMsg(from, buffer, extra = {}) {
    return { key: { remoteJid: from, id: 'M' + ++seq, fromMe: false }, pushName: 'Kunde', messageTimestamp: Math.floor((extra.at || Date.now()) / 1000), message: { imageMessage: { mimetype: extra.mimeType || 'image/jpeg', caption: extra.caption } }, _buffer: buffer };
  }
  function pdfMsg(from, buffer) {
    return { key: { remoteJid: from, id: 'M' + ++seq, fromMe: false }, pushName: 'Kunde', messageTimestamp: Math.floor(Date.now() / 1000), message: { documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'application/pdf', fileName: 'beleg.pdf' } } } }, _buffer: buffer };
  }
  async function say(msg) {
    const before = sent.length;
    await conversation.handleMessage(msg);
    return sent.slice(before).map((s) => s.text);
  }

  return {
    db, backend, conversation, customers, payments, sent, aiCalls, say, textMsg, imageMsg, pdfMsg, phoneJid,
    setConnected: (v) => { connected = v; },
  };
}

module.exports = { createHarness };
