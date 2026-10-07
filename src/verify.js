'use strict';
/**
 * Decides VERIFIED vs NEEDS_REVIEW from the extracted receipt data. Pure code — no AI.
 * Never rejects automatically: any failed check means a human looks at it.
 */

const { BANK, ACCOUNTS, CURRENCY, coachings } = require('./config');
const { formatMoney, normalizeCurrency } = require('./money');
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

// Masked numbers ("DE85 **** 6021 16", "****4567"): visible parts must match at the same positions
/**
 * Masked numbers ("DE85 **** 6021 16", "00****7015", "●●●●6229"): the visible digits must fit our account.
 * Returns true (fits), false (visible digits contradict our account) or null (too little visible to say).
 */
function maskedMatches(got, want, minVisible) {
  const [head, ...rest] = got.split(/\*+/);
  const tail = rest.pop() || '';
  if (head.length + tail.length < minVisible) return null;
  if (tail && !want.endsWith(tail)) return false;
  if (head.length >= 3 && !want.startsWith(head)) return false; // short prefixes like "00" are often just formatting
  if (!tail && head.length < 3) return null;
  return true;
}

// Pakistani numbers may be printed as 0337… or +92 337…
const normDigits = (s) => {
  const d = String(s || '').replace(/[•.…]/g, '*').replace(/[^0-9*]/g, '');
  return /^92\d{10}$/.test(d) ? '0' + d.slice(2) : d;
};

/** One account: true = matches, false = readable and different, null = not enough to decide */
function matchesOne(acc, printed) {
  if (acc.accountType === 'iban') {
    const got = normIban(printed);
    const want = normIban(acc.account);
    if (!got) return null;
    if (got === want) return true;
    if (got.includes('*')) return maskedMatches(got, want, 6);
    if (want.startsWith(got) || want.endsWith(got)) return got.length >= 10 ? true : null; // cut-off reading of our IBAN
    return false;
  }
  const got = normDigits(printed);
  const want = normDigits(acc.account);
  const visible = got.replace(/\*/g, '');
  if (!visible) return null;
  if (got === want) return true;
  if (got.includes('*')) return maskedMatches(got, want, 4);
  // only the last digits printed ("6781")
  if (got.length < 7) return got.length >= 4 ? want.endsWith(got) : null;
  // e.g. a Pakistani IBAN (PK.. + bank code + account number) contains the account number at the end
  const [shorter, longer] = got.length < want.length ? [got, want] : [want, got];
  return longer.endsWith(shorter);
}

/** Matches any accepted recipient account. */
function accountMatches(printed) {
  const results = ACCOUNTS.map((acc) => matchesOne(acc, printed));
  if (results.includes(true)) return true;
  return results.includes(false) ? false : null;
}

/** A complete, unmasked number that could be compared in full. */
function accountFullyReadable(printed) {
  if (ACCOUNTS.every((a) => a.accountType === 'iban')) {
    const n = normIban(printed);
    return n.length >= 20 && !n.includes('*');
  }
  const n = normDigits(printed);
  return !n.includes('*') && n.length >= Math.min(...ACCOUNTS.map((a) => normDigits(a.account).length));
}

const ibanMatches = accountMatches; // kept for tests / older callers

function nameMatches(printed) {
  const got = normName(printed);
  return got.length > 0 && ACCOUNTS.some((acc) => normName(acc.recipient).every((w) => got.includes(w)));
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

  // 2. Recipient: IBAN/account number or name must match. A fully readable but different number always fails.
  const iban = accountMatches(e.recipientIban);
  const name = nameMatches(e.recipientName);
  let recipientOk;
  let recipientDetail = '';
  // A readable account number that contradicts ours always fails – even if the name matches
  // (e.g. same name, but paid into a different bank account).
  if (iban === false) {
    recipientOk = false;
    recipientDetail = `${BANK.accountType === 'iban' ? 'Empfänger-IBAN' : 'Empfänger-Konto'} stimmt nicht (${e.recipientIban})`;
  } else {
    recipientOk = iban === true || name;
    if (!recipientOk) {
      recipientDetail =
        !e.recipientIban && !e.recipientName
          ? 'Empfänger nicht erkennbar'
          : `Empfänger stimmt nicht (${[e.recipientName, e.recipientIban].filter(Boolean).join(', ')})`;
    }
  }
  add('recipient', `Empfänger = ${ACCOUNTS.map((a) => a.recipient).join(' / ')}`, recipientOk, recipientDetail);

  // 2b. The AI's own view of the recipient (it saw the whole receipt). An explicit "no" sends it to review.
  if (e.recipientIsExpected === false && recipientOk) {
    add('aiRecipient', 'KI-Prüfung Empfänger', false, `KI: Empfänger passt nicht zum erwarteten Konto${e.aiNotes ? ' – ' + e.aiNotes : ''}`);
  }

  // 3. Amount = price of the selected coaching (in the configured currency)
  const price = ctx.coaching?.price;
  const amount = typeof e.amount === 'number' ? e.amount : null;
  const currencyOk = !e.currency || normalizeCurrency(e.currency) === CURRENCY;
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

  // 4b. Transfer really completed (not pending/failed) and nothing looks edited
  add('completed', 'Überweisung ausgeführt', e.transferCompleted !== false, e.transferCompleted === false ? 'Überweisung nicht abgeschlossen (z. B. ausstehend oder fehlgeschlagen)' : '');
  if (e.suspicious === true) {
    add('suspicious', 'Beleg unauffällig', false, `KI-Hinweis: Beleg wirkt verdächtig${e.aiNotes ? ' – ' + e.aiNotes : ''}`);
  }

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
  return formatMoney(n, CURRENCY, { decimals: 2 });
}
function fmtDate(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}
function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('de-DE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '?';
}

module.exports = { verify, resolveDate, ibanMatches, accountMatches, nameMatches, senderFromReference, berlinDate, MAX_AGE_DAYS };
