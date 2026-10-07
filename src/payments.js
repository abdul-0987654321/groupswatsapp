'use strict';
/**
 * Payment records: created from a receipt, decided automatically (VERIFIED) or by an
 * admin (VERIFIED / REJECTED). NEEDS_REVIEW = waiting for an admin.
 */

const db = require('./storage/db');
const log = require('./log');
const { getCoaching, CURRENCY, MODE, ACCOUNTS } = require('./config');
const customers = require('./customers');
const { readReceipt } = require('./receipt-reader');
const { verify } = require('./verify');
const { fingerprints } = require('./image-hash');

const STATUS = {
  VERIFIED: 'VERIFIED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  REJECTED: 'REJECTED',
  SUPERSEDED: 'SUPERSEDED', // an older pending receipt replaced by a newer one from the same customer
};

const now = () => new Date().toISOString();

function nextPaymentId() {
  let max = 1000;
  for (const p of db.all('payments')) {
    const n = Number(String(p.id).replace(/\D/g, ''));
    if (n > max) max = n;
  }
  return 'Z-' + (max + 1);
}

function all() {
  return db.all('payments').sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
}

function get(id) {
  return db.get('payments', id);
}

function forCustomer(jid) {
  return all().filter((p) => p.jid === jid);
}

/**
 * Reads + checks a receipt (does not message anyone).
 * Returns the stored payment record.
 */
async function processReceipt({ customer, coaching, buffer, mimeType, receivedAt }) {
  const fp = await fingerprints(buffer, mimeType);
  const id = nextPaymentId();
  const ext = mimeType === 'application/pdf' ? 'pdf' : (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const [readRes, fileRes] = await Promise.allSettled([
    readReceipt(buffer, mimeType, { accounts: ACCOUNTS, amount: coaching.price, currency: CURRENCY }),
    db.putFile(`${id}_${customer.phone || customer.id}.${ext}`, mimeType, buffer),
  ]);
  if (fileRes.status === 'rejected') log.error(`Saving screenshot ${id} to Drive failed: ${fileRes.reason?.message}`);

  const previousPayments = db.all('payments');
  let result;
  let extracted = null;
  if (readRes.status === 'fulfilled') {
    extracted = readRes.value;
    result = verify(extracted, { coaching, receivedAt, imageHash: fp.imageHash, thumbnail: fp.thumbnail, previousPayments });
  } else {
    log.error(`Reading receipt ${id} failed: ${readRes.reason?.message}`);
    result = {
      status: STATUS.NEEDS_REVIEW,
      reasons: [`Beleg konnte nicht automatisch gelesen werden (${readRes.reason?.message || 'Fehler'})`],
      checks: [],
      paymentDate: null,
      senderName: null,
      duplicateOf: null,
    };
  }

  // An older receipt of this customer that is still waiting is replaced by this one.
  for (const p of previousPayments) {
    if (p.jid === customer.jid && p.status === STATUS.NEEDS_REVIEW) {
      db.put('payments', { ...p, status: STATUS.SUPERSEDED, supersededBy: id, decidedAt: now() });
    }
  }

  const payment = {
    id,
    jid: customer.jid,
    customerId: customer.id,
    phone: customer.phone,
    name: result.senderName || customer.pushName || null,
    coachingId: coaching.id,
    coachingName: coaching.name,
    expectedAmount: coaching.price,
    expectedCurrency: CURRENCY,
    mode: MODE, // "test" payments come from the test account / test prices
    amount: extracted?.amount ?? null,
    currency: extracted?.currency ?? null,
    paymentDate: result.paymentDate,
    status: result.status,
    reasons: result.reasons,
    checks: result.checks,
    senderName: result.senderName,
    duplicateOf: result.duplicateOf,
    extracted,
    imageHash: fp.imageHash,
    thumbnail: fp.thumbnail,
    screenshotFileId: fileRes.status === 'fulfilled' ? fileRes.value : null,
    mimeType,
    receivedAt,
    decidedAt: result.status === STATUS.VERIFIED ? now() : null,
    decidedBy: result.status === STATUS.VERIFIED ? 'auto' : null,
    linkSent: false,
  };
  db.put('payments', payment);
  log.info(`Receipt ${id} from ${customer.phone || customer.jid} for ${coaching.id}: ${payment.status}${payment.reasons.length ? ' – ' + payment.reasons.join('; ') : ''}`);
  return payment;
}

function decide(id, status, by = 'admin', note = '') {
  const p = get(id);
  if (!p) throw new Error('Zahlung nicht gefunden');
  const updated = { ...p, status, decidedAt: now(), decidedBy: by, note: note || p.note || '' };
  db.put('payments', updated);
  const customer = customers.get(p.jid);
  if (customer) {
    if (status === STATUS.VERIFIED) {
      customer.stage = customers.STAGES.VERIFIED;
      customer.coachingId = p.coachingId;
    } else if (status === STATUS.REJECTED && customer.stage !== customers.STAGES.VERIFIED) {
      customer.stage = customers.STAGES.AWAITING_SCREENSHOT; // may send a valid receipt now
      customer.coachingId = p.coachingId;
    }
    customers.save(customer);
  }
  return { payment: updated, customer, coaching: getCoaching(p.coachingId) };
}

function markLinkSent(id) {
  const p = get(id);
  if (p) db.put('payments', { ...p, linkSent: true, linkSentAt: now() });
}

/** The latest VERIFIED payment of a customer (decides which group link they get). */
function latestVerified(jid) {
  return forCustomer(jid).find((p) => p.status === STATUS.VERIFIED) || null;
}

/** The customer's verified payment for one specific coaching (they may own several). */
function verifiedFor(jid, coachingId) {
  return forCustomer(jid).find((p) => p.status === STATUS.VERIFIED && p.coachingId === coachingId) || null;
}

module.exports = { STATUS, all, get, forCustomer, processReceipt, decide, markLinkSent, latestVerified, verifiedFor };
