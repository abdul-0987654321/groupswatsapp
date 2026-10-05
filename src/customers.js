'use strict';
/**
 * Customer records + chat history.
 *
 * WhatsApp may address the same person by phone JID (…@s.whatsapp.net) or by LID (…@lid).
 * Customers are keyed by the phone JID when known, and the LID is kept as an alias so
 * the conversation state is never split in two.
 */

const crypto = require('crypto');
const db = require('./storage/db');

const STAGES = {
  NEW: 'new',
  ASK_COACHING: 'ask_coaching',
  AWAITING_SCREENSHOT: 'awaiting_screenshot',
  IN_REVIEW: 'in_review',
  VERIFIED: 'verified',
};

const now = () => new Date().toISOString();

function phoneFromJid(jid) {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null;
  return '+' + jid.split('@')[0].split(':')[0];
}

/** Resolves the identity of the sender of an incoming message. */
function identify(msg) {
  const remote = msg.key.remoteJid;
  const alt = msg.key.remoteJidAlt || null;
  const pnJid = remote.endsWith('@s.whatsapp.net') ? remote : alt?.endsWith('@s.whatsapp.net') ? alt : null;
  const lid = remote.endsWith('@lid') ? remote : alt?.endsWith('@lid') ? alt : null;
  return { replyJid: remote, pnJid, lid };
}

function findByLid(lid) {
  return lid ? db.all('customers').find((c) => c.lid === lid) || null : null;
}

function nextCustomerNumber() {
  let max = 1000;
  for (const c of db.all('customers')) {
    const n = Number(String(c.id || '').replace(/\D/g, ''));
    if (n > max) max = n;
  }
  return 'K-' + (max + 1);
}

/** Returns the (possibly new) customer for an incoming message and records name/addressing changes. */
function getOrCreate(msg) {
  const { replyJid, pnJid, lid } = identify(msg);
  let c = (pnJid && db.get('customers', pnJid)) || findByLid(lid) || db.get('customers', replyJid);
  if (c && pnJid && c.jid !== pnJid) {
    // First time we learn the phone number for a LID-only customer: re-key the record.
    const oldJid = c.jid;
    db.remove('customers', oldJid);
    c = { ...c, jid: pnJid, phone: phoneFromJid(pnJid) };
    for (const p of db.all('payments')) if (p.jid === oldJid) db.put('payments', { ...p, jid: pnJid, phone: c.phone });
  }
  if (!c) {
    const jid = pnJid || replyJid;
    c = {
      jid,
      id: nextCustomerNumber(),
      phone: phoneFromJid(jid),
      lid,
      name: null,
      pushName: null,
      replyJid,
      stage: STAGES.NEW,
      coachingId: null,
      createdAt: now(),
      updatedAt: now(),
    };
  }
  c.replyJid = replyJid;
  if (lid) c.lid = lid;
  if (msg.pushName) c.pushName = msg.pushName;
  return save(c);
}

function save(c) {
  c.updatedAt = now();
  return db.put('customers', c);
}

function get(jid) {
  return db.get('customers', jid);
}

function all() {
  return db.all('customers');
}

function displayName(c) {
  return c?.name || c?.pushName || c?.phone || c?.jid || '';
}

function logChat(c, direction, text) {
  return db.put('chat', {
    id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    at: now(),
    jid: c.jid,
    direction, // 'in' | 'out'
    text: String(text || ''),
  });
}

function chatHistory(jid) {
  const c = get(jid);
  const ids = new Set([jid, c?.lid, c?.replyJid].filter(Boolean));
  return db.all('chat').filter((m) => ids.has(m.jid)).sort((a, b) => a.at.localeCompare(b.at));
}

module.exports = { STAGES, identify, getOrCreate, save, get, all, displayName, logChat, chatHistory, phoneFromJid };
