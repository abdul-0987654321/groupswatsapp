'use strict';
/**
 * Conversation flow (German, plain text, never lists the coachings):
 *
 *   new / ask_coaching ── coaching recognised ──► awaiting_screenshot (price + bank details sent)
 *   awaiting_screenshot ── receipt ──► VERIFIED → link sent          (stage verified)
 *                                   └► NEEDS_REVIEW → "wird geprüft"  (stage in_review)
 *   in_review ── admin "Bestätigen" ──► link sent (verified) / "Ablehnen" ──► awaiting_screenshot
 *   verified ── any message ──► group link sent again
 */

const log = require('./log');
const msgs = require('./messages');
const customers = require('./customers');
const payments = require('./payments');
const { getCoaching } = require('./config');
const { detectCoaching, keywordMatches } = require('./coaching-detect');

const { STAGES } = customers;
let bot = null;

// ---------- message parsing ----------

function unwrap(m) {
  for (let i = 0; i < 4 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.documentWithCaptionMessage?.message ||
      m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m || {};
}

function getText(m) {
  return (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.documentMessage?.caption || '').trim();
}

/** Receipt files we accept: images, and PDFs/images sent as documents. */
function getMedia(m) {
  if (m.imageMessage) return { mimeType: m.imageMessage.mimetype || 'image/jpeg', label: 'Bild' };
  const doc = m.documentMessage;
  if (doc && (doc.mimetype === 'application/pdf' || String(doc.mimetype).startsWith('image/'))) {
    return { mimeType: doc.mimetype, label: doc.mimetype === 'application/pdf' ? 'PDF' : 'Bild' };
  }
  return null;
}

/** Messages that carry nothing a customer "said" (reactions, receipts, protocol updates). */
function isSilent(m) {
  return Boolean(m.reactionMessage || m.protocolMessage || m.pollUpdateMessage || m.senderKeyDistributionMessage && Object.keys(m).length === 1);
}

// ---------- sending ----------

async function reply(customer, text) {
  await bot.sendText(customer.replyJid || customer.jid, text);
  customers.logChat(customer, 'out', text);
}

async function sendGroupLink(customer, payment, { again = false } = {}) {
  const coaching = getCoaching(payment.coachingId);
  if (!coaching?.groupLink) {
    log.warn(`No group link configured for ${payment.coachingId} — told ${customer.phone || customer.jid} it follows shortly.`);
    await reply(customer, msgs.verifiedLinkPending());
    return false;
  }
  await reply(customer, again ? msgs.alreadyVerified(coaching) : msgs.verified(coaching));
  payments.markLinkSent(payment.id);
  return true;
}

// ---------- flow ----------

async function startCoaching(customer, coaching) {
  customer.coachingId = coaching.id;
  customer.stage = STAGES.AWAITING_SCREENSHOT;
  customers.save(customer);
  await reply(customer, msgs.price(coaching));
}

async function handleReceipt(customer, msg, media) {
  const coaching = getCoaching(customer.coachingId);
  let buffer;
  try {
    buffer = await bot.downloadImage(msg);
  } catch (err) {
    log.warn(`Downloading receipt from ${customer.jid} failed: ${err.message}`);
    await reply(customer, msgs.imageUnreadable());
    return;
  }
  customer.stage = STAGES.IN_REVIEW;
  customers.save(customer);

  const receivedAt = new Date(Number(msg.messageTimestamp || Date.now() / 1000) * 1000).toISOString();
  const payment = await payments.processReceipt({ customer, coaching, buffer, mimeType: media.mimeType, receivedAt });

  if (payment.status === payments.STATUS.VERIFIED) {
    const { customer: c } = payments.decide(payment.id, payments.STATUS.VERIFIED, 'auto');
    await sendGroupLink(c || customer, payment);
  } else {
    await reply(customer, msgs.inReview());
  }
}

async function handleMessage(msg) {
  const m = unwrap(msg.message);
  if (isSilent(m)) return;
  const customer = customers.getOrCreate(msg);
  const media = getMedia(m);
  const text = getText(m);
  customers.logChat(customer, 'in', media ? `[${media.label}]${text ? ' ' + text : ''}` : text || '[Nachricht ohne Text]');

  switch (customer.stage) {
    case STAGES.VERIFIED: {
      const paid = payments.latestVerified(customer.jid);
      if (paid) return sendGroupLink(customer, paid, { again: true });
      // Verified flag without a payment (e.g. record edited by hand): start over.
      customer.stage = STAGES.ASK_COACHING;
      customers.save(customer);
      return reply(customer, msgs.askCoaching());
    }

    case STAGES.IN_REVIEW:
      if (media) return handleReceipt(customer, msg, media);
      return reply(customer, msgs.stillInReview());

    case STAGES.AWAITING_SCREENSHOT: {
      if (media) return handleReceipt(customer, msg, media);
      // Customer changes their mind ("doch lieber Money") — only on a clear keyword, never via AI.
      const hits = keywordMatches(text);
      if (hits.length === 1 && hits[0] !== customer.coachingId) return startCoaching(customer, getCoaching(hits[0]));
      return reply(customer, msgs.remindScreenshot());
    }

    case STAGES.NEW:
    case STAGES.ASK_COACHING:
    default: {
      const isFirst = customer.stage === STAGES.NEW;
      const { id } = text ? await detectCoaching(text) : { id: null };
      if (id) return startCoaching(customer, getCoaching(id));
      customer.stage = STAGES.ASK_COACHING;
      customers.save(customer);
      return reply(customer, isFirst ? msgs.welcome() : msgs.askCoaching());
    }
  }
}

// Messages from the same person are handled strictly one after another.
const queues = new Map();
function enqueue(msg) {
  const key = msg.key.remoteJid;
  const prev = queues.get(key) || Promise.resolve();
  const next = prev
    .then(() => handleMessage(msg))
    .catch((err) => log.error(`Conversation error for ${key}: ${err.stack || err.message}`))
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
  queues.set(key, next);
  return next;
}

// ---------- admin actions (dashboard) ----------

async function approvePayment(id) {
  const p = payments.get(id);
  if (!p) throw new Error('Zahlung nicht gefunden');
  if (![payments.STATUS.NEEDS_REVIEW, payments.STATUS.REJECTED, payments.STATUS.SUPERSEDED].includes(p.status)) {
    throw new Error('Diese Zahlung ist bereits bestätigt.');
  }
  const { payment, customer } = payments.decide(id, payments.STATUS.VERIFIED, 'admin');
  if (!customer) return { ok: true, warning: 'Kunde nicht gefunden – Link nicht gesendet.' };
  try {
    const sent = await sendGroupLink(customer, payment);
    return sent ? { ok: true } : { ok: true, warning: 'Für dieses Coaching ist noch kein Gruppenlink eingetragen – der Kunde wurde informiert, dass der Link folgt.' };
  } catch (err) {
    return { ok: true, warning: `Bestätigt, aber Nachricht nicht gesendet: ${err.message}. Bitte später „Link erneut senden“.` };
  }
}

async function rejectPayment(id) {
  const p = payments.get(id);
  if (!p) throw new Error('Zahlung nicht gefunden');
  if (p.status === payments.STATUS.VERIFIED) throw new Error('Bestätigte Zahlungen können nicht abgelehnt werden.');
  const isLatest = payments.forCustomer(p.jid)[0]?.id === id;
  const { customer } = payments.decide(id, payments.STATUS.REJECTED, 'admin');
  if (!customer || !isLatest || p.status === payments.STATUS.SUPERSEDED) return { ok: true };
  try {
    await reply(customer, msgs.rejected());
    return { ok: true };
  } catch (err) {
    return { ok: true, warning: `Abgelehnt, aber Nachricht nicht gesendet: ${err.message}` };
  }
}

async function resendLink(id) {
  const p = payments.get(id);
  if (!p || p.status !== payments.STATUS.VERIFIED) throw new Error('Nur für bestätigte Zahlungen möglich.');
  const customer = customers.get(p.jid);
  if (!customer) throw new Error('Kunde nicht gefunden');
  const sent = await sendGroupLink(customer, p);
  return sent ? { ok: true } : { ok: true, warning: 'Für dieses Coaching ist noch kein Gruppenlink eingetragen.' };
}

function attach(b) {
  bot = b;
  bot.onMessage(enqueue);
}

module.exports = { attach, handleMessage: enqueue, approvePayment, rejectPayment, resendLink, _unwrap: unwrap, _getMedia: getMedia };
