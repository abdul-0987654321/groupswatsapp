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
const { detectCoaching, classifyPaidCustomer, keywordMatches, isOnlyGreeting, isOnlyThanks, isYes, wantsChange } = require('./coaching-detect');
const alerts = require('./alerts');
const settings = require('./settings');
const db = require('./storage/db');

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
  customer.askCount = 0;
  customer.priceSentAt = new Date().toISOString(); // a matching payment can't be older than this
  customer.stage = STAGES.AWAITING_SCREENSHOT;
  customers.save(customer);
  await reply(customer, msgs.price(coaching));
}

async function handleReceipt(customer, msg, media, chatEntry) {
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
  if (chatEntry) customers.updateChat(chatEntry, { fileId: payment.screenshotFileId, mimeType: media.mimeType, paymentId: payment.id });

  if (payment.status === payments.STATUS.VERIFIED) {
    const { customer: c } = payments.decide(payment.id, payments.STATUS.VERIFIED, 'auto');
    await sendGroupLink(c || customer, payment);
    alerts.notify('verified', payments.get(payment.id), c || customer);
  } else {
    await reply(customer, msgs.inReview());
    alerts.notify('review', payment, customer);
  }
}

/** Images sent outside the payment step are still saved, so the dashboard chat can show them. */
function storeChatMedia(customer, msg, media, chatEntry) {
  void (async () => {
    try {
      const buffer = await bot.downloadImage(msg);
      const ext = media.mimeType === 'application/pdf' ? 'pdf' : 'jpg';
      const fileId = await db.putFile(`chat_${customer.phone || customer.id}_${chatEntry.id}.${ext}`, media.mimeType, buffer);
      customers.updateChat(chatEntry, { fileId, mimeType: media.mimeType });
    } catch (err) {
      log.warn(`Saving chat media from ${customer.jid} failed: ${err.message}`);
    }
  })();
}

async function handleMessage(msg) {
  const m = unwrap(msg.message);
  if (isSilent(m)) return;
  const { pnJid, replyJid } = customers.identify(msg);
  if (alerts.isAdmin(pnJid || replyJid)) {
    log.info(`Message from admin number ${pnJid || replyJid} ignored (admins get alerts, not the customer flow).`);
    return;
  }
  const customer = customers.getOrCreate(msg);
  const media = getMedia(m);
  const text = getText(m);
  const chatEntry = customers.logChat(customer, 'in', media ? `[${media.label}]${text ? ' ' + text : ''}` : text || '[Nachricht ohne Text]', media ? { mimeType: media.mimeType } : {});
  const isReceiptStep = customer.stage === STAGES.AWAITING_SCREENSHOT || customer.stage === STAGES.IN_REVIEW;
  // Bot paused from the dashboard: keep the message (and image) in the chat, but don't reply.
  if (settings.get('botEnabled') === false) {
    if (media) storeChatMedia(customer, msg, media, chatEntry);
    return;
  }
  if (media && !isReceiptStep) storeChatMedia(customer, msg, media, chatEntry);

  switch (customer.stage) {
    case STAGES.VERIFIED: {
      const paid = payments.latestVerified(customer.jid);
      if (!paid) {
        // Verified flag without a payment (e.g. record edited by hand): start over.
        customer.stage = STAGES.ASK_COACHING;
        customers.save(customer);
        return reply(customer, msgs.askCoaching());
      }
      if (media) return sendGroupLink(customer, paid, { again: true });
      const askAnother = () => {
        customer.stage = STAGES.ASK_COACHING;
        customer.coachingId = null;
        customers.save(customer);
        return reply(customer, msgs.askAnotherCoaching());
      };
      const chooseCoaching = (id) => {
        const owned = payments.verifiedFor(customer.jid, id);
        return owned ? sendGroupLink(customer, owned, { again: true }) : startCoaching(customer, getCoaching(id)); // new one = new purchase
      };
      // 1. rules first: a coaching name, "new group"/"another", "yes" (answer to our offer), "thanks"
      const hits = keywordMatches(text);
      if (hits.length === 1) return chooseCoaching(hits[0]);
      if (wantsChange(text) || isYes(text)) return askAnother();
      if (isOnlyThanks(text)) return reply(customer, msgs.youreWelcome());
      if (isOnlyGreeting(text)) return sendGroupLink(customer, paid, { again: true });
      // 2. AI fallback for everything else — it may only return a code, the reply stays a fixed text
      const owned = payments.forCustomer(customer.jid).filter((p) => p.status === payments.STATUS.VERIFIED).map((p) => getCoaching(p.coachingId)?.name).filter(Boolean);
      const intent = await classifyPaidCustomer(text, [...new Set(owned)]);
      if (getCoaching(intent)) return chooseCoaching(intent);
      if (intent === 'NEW') return askAnother();
      return sendGroupLink(customer, paid, { again: true });
    }

    case STAGES.IN_REVIEW:
      if (media) return handleReceipt(customer, msg, media, chatEntry);
      return reply(customer, msgs.stillInReview());

    case STAGES.AWAITING_SCREENSHOT: {
      if (media) return handleReceipt(customer, msg, media, chatEntry);
      const current = getCoaching(customer.coachingId);
      // Clear keyword: switch to that coaching (or repeat the details for the same one).
      const hits = keywordMatches(text);
      if (hits.length === 1) return startCoaching(customer, getCoaching(hits[0]));
      // "I want to change group" → ask again which coaching.
      if (wantsChange(text) || !current) {
        customer.stage = STAGES.ASK_COACHING;
        customer.coachingId = null;
        customers.save(customer);
        return reply(customer, msgs.changeCoaching());
      }
      // "Hi" again → repeat price + bank details, they may have lost them.
      if (isOnlyGreeting(text)) return reply(customer, msgs.price(current));
      return reply(customer, msgs.remindScreenshot(current));
    }

    case STAGES.NEW:
    case STAGES.ASK_COACHING:
    default: {
      const isFirst = customer.stage === STAGES.NEW;
      const { id, notOffered } = text ? await detectCoaching(text) : { id: null };
      // Already paid for that coaching → just send that link again (no second payment).
      const owned = id && payments.verifiedFor(customer.jid, id);
      if (owned) {
        customer.stage = STAGES.VERIFIED;
        customers.save(customer);
        return sendGroupLink(customer, owned, { again: true });
      }
      if (id) return startCoaching(customer, getCoaching(id));
      // Not recognised: never list the coachings, but don't repeat the exact same question either.
      customer.stage = STAGES.ASK_COACHING;
      customer.askCount = isFirst ? 0 : (customer.askCount || 0) + 1;
      customers.save(customer);
      if (isFirst) return reply(customer, msgs.welcome());
      if (notOffered) return reply(customer, msgs.notOffered());
      const variants = [msgs.askCoaching, msgs.askCoachingHint, msgs.askCoachingHelp];
      return reply(customer, variants[(customer.askCount - 1) % variants.length]());
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

// Decisions always notify the customer, so they are only allowed while WhatsApp is connected.
function requireConnected() {
  if (!bot?.isConnected?.()) throw new Error('WhatsApp ist nicht verbunden – bitte zuerst unter „WhatsApp verbinden“ die Verbindung herstellen.');
}

async function approvePayment(id) {
  requireConnected();
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
  requireConnected();
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
  requireConnected();
  const p = payments.get(id);
  if (!p || p.status !== payments.STATUS.VERIFIED) throw new Error('Nur für bestätigte Zahlungen möglich.');
  const customer = customers.get(p.jid);
  if (!customer) throw new Error('Kunde nicht gefunden');
  const sent = await sendGroupLink(customer, p);
  return sent ? { ok: true } : { ok: true, warning: 'Für dieses Coaching ist noch kein Gruppenlink eingetragen.' };
}

function attach(b) {
  bot = b;
  alerts.setBot(b);
  bot.onMessage(enqueue);
}

module.exports = { attach, handleMessage: enqueue, approvePayment, rejectPayment, resendLink, _unwrap: unwrap, _getMedia: getMedia };
