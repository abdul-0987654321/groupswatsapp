'use strict';
/**
 * Decides VERIFIED vs NEEDS_REVIEW from the extracted receipt data. Pure code — no AI.
 * Never rejects automatically: any failed check means a human looks at it.
 */

const { BANK, CURRENCY, coachings } = require('./config');
const { isNearDuplicate } = require('./image-hash');

const MAX_AGE_DAYS = 7;
const TZ = 'Europe/Berlin';

// ---------- helpers ----------

const normIban = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9*•.…]/g, '').replace(/[•.…]/g, '*');
const normName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .split(' ').filter(Boolean);

function ibanMatches(printed) {
  const got = normIban(printed);
  const want = normIban(BANK.iban);
  if (!got) return null; // not readable
  if (got === want) return true;
  if (got.includes('*')) {
    // Masked IBAN, e.g. "DE85 **** **** **** 6021 16": visible parts must match at the same positions
    const [head, ...rest] = got.split(/\*+/);
    const tail = rest.pop() || '';
    return head.length + tail.length >= 6 && want.startsWith(head) && want.endsWith(tail);
  }
  return false;
}

function nameMatches(printed) {
  const got = normName(printed);
  const want = normName(BANK.recipient);
  return got.length > 0 && want.every((w) => got.includes(w));
}

/** Calendar date (YYYY-MM-DD) of an instant in Berlin time. */
function berlinDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const MONTHS = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mar: 3, maerz: 3, marz: 3, march: 3, apr: 4, april: 4,
  mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dez: 12, dec: 12, dezember: 12, december: 12,
};

const RELATIVE_TODAY = /\b(heute|today|gerade|eben|just now|now|jetzt|minute|minuten|minutes|sekunden|seconds|stunde|stunden|hour|hours|vor kurzem|few)\b/i;
const RELATIVE_YESTERDAY = /\b(gestern|yesterday)\b/i;

/**
 * Turns the printed date into YYYY-MM-DD. Relative dates ("Heute", "A few minutes ago")
 * use the date the WhatsApp message was received.
 * Returns { date, relative } or null.
 */
function resolveDate(printed, receivedAt) {
  if (!printed) return null;
  const s = String(printed).trim();
  const received = new Date(receivedAt || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (y, m, d) => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  };
  let m;
  if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) return wrap(ymd(+m[1], +m[2], +m[3]));
  if ((m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/))) return wrap(ymd(+m[3], +m[2], +m[1]));
  if ((m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return wrap(ymd(+m[3], +m[2], +m[1])); // EU order
  if ((m = s.toLowerCase().replace(/ä/g, 'ae').match(/(\d{1,2})\.?\s+([a-z]+)\.?,?\s+(\d{4})/)) && MONTHS[m[2]]) {
    return wrap(ymd(+m[3], MONTHS[m[2]], +m[1]));
  }
  if ((m = s.toLowerCase().match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/)) && MONTHS[m[1]]) {
    return wrap(ymd(+m[3], MONTHS[m[1]], +m[2]));
  }
  if (RELATIVE_YESTERDAY.test(s)) return { date: berlinDate(new Date(received.getTime() - 86400000)), relative: true };
  if (RELATIVE_TODAY.test(s)) return { date: berlinDate(received), relative: true };
  return null;

  function wrap(date) {
    return date ? { date, relative: false } : null;
  }
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/**
 * Sender name from the receipt; if missing, guessed from the reference text
 * ("Probetermin, Anna Schwarz, Biochemie", "Package 4, NAME", "Name + Biochemie").
 */
const REFERENCE_NOISE = new Set([
  'probetermin', 'termin', 'biochemie', 'package', 'paket', 'coaching', 'coachings', 'datum', 'uhr', 'zahlung', 'fuer', 'for',
  'und', 'and', 'mein', 'name', 'von', 'überweisung', 'ueberweisung', 'gebuehr', 'kurs', 'gruppe', 'plus',
  ...coachings.flatMap((c) => [...normName(c.name), ...c.keywords]),
]);
function senderFromReference(reference) {
  if (!reference) return null;
  const parts = String(reference).split(/[,+;|\n]|\s-\s/).map((p) => p.trim()).filter(Boolean);
  const candidates = parts
    .map((p) =>
      p.split(/\s+/)
        .filter((w) => /^[A-Za-zÀ-ÿ'-]{2,}$/.test(w) && !REFERENCE_NOISE.has(normName(w).join('')))
        .join(' ')
    )
    .filter((p) => p.split(' ').length >= 2 && p.split(' ').length <= 5);
  if (!candidates.length) return null;
  return candidates
    .sort((a, b) => b.split(' ').length - a.split(' ').length)[0]
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const normRef = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- main ----------

/**
 * @param extracted  fields from receipt-reader
 * @param ctx        { coaching, receivedAt, imageHash, thumbnail, previousPayments: [] }
 * @returns { status, reasons, checks, paymentDate, senderName, duplicateOf }
 */
function verify(extracted, ctx) {
  const e = extracted || {};
  const checks = [];
  const add = (key, label, ok, detail) => checks.push({ key, label, ok, detail: detail || '' });

  // 1. Is it a receipt at all?
  add('receipt', 'Zahlungsbeleg erkannt', e.isPaymentReceipt === true, e.isPaymentReceipt ? '' : 'Kein Zahlungsbeleg erkannt');

  // 2. Recipient: IBAN or name must match. A fully readable but different IBAN always fails.
  const iban = ibanMatches(e.recipientIban);
  const name = nameMatches(e.recipientName);
  const fullIbanReadable = normIban(e.recipientIban).length >= 20 && !normIban(e.recipientIban).includes('*');
  let recipientOk;
  let recipientDetail = '';
  if (iban === false && fullIbanReadable) {
    recipientOk = false;
    recipientDetail = `Empfänger-IBAN stimmt nicht (${e.recipientIban})`;
  } else {
    recipientOk = iban === true || name;
    if (!recipientOk) {
      recipientDetail =
        !e.recipientIban && !e.recipientName
          ? 'Empfänger nicht erkennbar'
          : `Empfänger stimmt nicht (${[e.recipientName, e.recipientIban].filter(Boolean).join(', ')})`;
    }
  }
  add('recipient', `Empfänger = ${BANK.recipient}`, recipientOk, recipientDetail);

  // 3. Amount = price of the selected coaching (EUR)
  const price = ctx.coaching?.price;
  const amount = typeof e.amount === 'number' ? e.amount : null;
  const currencyOk = !e.currency || String(e.currency).toUpperCase().replace('€', 'EUR') === CURRENCY;
  let amountDetail = '';
  if (amount == null) amountDetail = 'Betrag nicht erkennbar';
  else if (!currencyOk) amountDetail = `Falsche Währung (${e.currency})`;
  else if (Math.abs(amount - price) > 0.009) amountDetail = `Falscher Betrag: ${fmtEuro(amount)} statt ${fmtEuro(price)}`;
  add('amount', `Betrag = ${fmtEuro(price)}`, !amountDetail, amountDetail);

  // 4. Date within the last 7 days
  const resolved = resolveDate(e.date, ctx.receivedAt);
  const today = berlinDate(new Date(ctx.receivedAt || Date.now()));
  let dateDetail = '';
  if (!resolved) dateDetail = 'Datum nicht erkennbar';
  else {
    const age = daysBetween(resolved.date, today);
    if (age > MAX_AGE_DAYS) dateDetail = `Zu alt: Zahlung vom ${fmtDate(resolved.date)} (${age} Tage)`;
    else if (age < -1) dateDetail = `Datum liegt in der Zukunft (${fmtDate(resolved.date)})`;
  }
  add('date', `Datum innerhalb von ${MAX_AGE_DAYS} Tagen`, !dateDetail, dateDetail);

  // 5. Sender name (from receipt, else from reference)
  const senderName = e.senderName || senderFromReference(e.reference) || null;

  // 6. Duplicate: same image, or same reference + amount + date + sender
  let duplicateOf = null;
  const prev = ctx.previousPayments || [];
  for (const p of prev) {
    const pe = p.extracted || {};
    if (ctx.imageHash && p.imageHash === ctx.imageHash) {
      duplicateOf = p;
      break;
    }
    // Same picture re-compressed/resized (and showing the same amount)
    if (ctx.thumbnail && p.thumbnail && isNearDuplicate(ctx.thumbnail, p.thumbnail) && amount != null && amount === pe.amount) {
      duplicateOf = p;
      break;
    }
    const pDate = p.paymentDate || resolveDate(pe.date, p.receivedAt)?.date;
    if (
      normRef(e.reference) && normRef(e.reference) === normRef(pe.reference) &&
      amount != null && amount === pe.amount &&
      resolved?.date && resolved.date === pDate &&
      normName(senderName).join(' ') === normName(p.senderName).join(' ')
    ) {
      duplicateOf = p;
      break;
    }
  }
  add(
    'duplicate',
    'Kein Duplikat',
    !duplicateOf,
    duplicateOf ? `Duplikat: gleicher Beleg wurde bereits am ${fmtDateTime(duplicateOf.receivedAt)} eingereicht (${duplicateOf.id})` : ''
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    status: failed.length ? 'NEEDS_REVIEW' : 'VERIFIED',
    reasons: failed.map((c) => c.detail),
    checks,
    paymentDate: resolved?.date || null,
    dateWasRelative: resolved?.relative || false,
    senderName,
    duplicateOf: duplicateOf?.id || null,
  };
}

function fmtEuro(n) {
  return n == null ? '?' : `${Number(n).toFixed(2).replace('.', ',')} €`;
}
function fmtDate(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}
function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('de-DE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '?';
}

module.exports = { verify, resolveDate, ibanMatches, nameMatches, senderFromReference, berlinDate, MAX_AGE_DAYS };
