'use strict';
/**
 * Sends the Zoom link to everyone who booked a package that has a "reminder" text, one hour
 * before the meeting starts.
 *
 * The meeting time and link are set in the dashboard (Einstellungen). The time is entered as
 * local wall time in the configured time zone, e.g. "2026-11-24T19:30" — not UTC, because
 * that is how the client reads a Zoom invitation.
 *
 * Each customer is sent the link once per meeting: settings.zoomSent records which jids have
 * had this meeting's link, and resets when the meeting time changes. So a restart, a second
 * deploy or a missed tick never sends the same link twice, and a customer who books after
 * the window has opened still gets it on the next tick.
 */

const settings = require('./settings');
const customers = require('./customers');
const payments = require('./payments');
const msgs = require('./messages');
const log = require('./log');
const { menus, getMenuEntry, TIMEZONE } = require('./config');

const MINUTE = 60 * 1000;
const LEAD_MS = 60 * MINUTE; // how long before the meeting the link goes out
/** Still send after the window opens (late booking, server asleep), but never after this. */
const GRACE_AFTER_START_MS = 30 * MINUTE;

let timer = null;
let bot = null;

/**
 * "2026-11-24T19:30" read as wall time in `tz` → a real instant.
 * Works by asking what that instant looks like in `tz` and correcting by the difference,
 * which handles summer time without a date library.
 */
function instantFromLocal(local, tz = TIMEZONE) {
  const naive = Date.parse(`${local}:00Z`);
  if (Number.isNaN(naive)) return null;
  // What UTC clock time does `tz` show for this instant? The gap is the zone's offset.
  const shown = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(naive)).replace(', ', 'T');
  const offset = Date.parse(`${shown}Z`) - naive;
  return new Date(naive - offset);
}

/** The meeting as configured, or null when none is set. */
function meeting() {
  const at = settings.get('zoomMeetingAt');
  const link = settings.get('zoomLink');
  if (!at || !link) return null;
  const starts = instantFromLocal(at);
  if (!starts) return null;
  return { at, link, starts, opensAt: new Date(starts.getTime() - LEAD_MS) };
}

/** Packages whose menu entry carries a reminder text — those are the ones we remind. */
function reminderPackageIds() {
  const ids = [];
  for (const m of menus) for (const o of m.options) if (o.texts.de?.reminder) ids.push(o.id);
  return ids;
}

/**
 * Sends the link to anyone still owed it. Safe to call as often as you like.
 * Returns a short summary, which the dashboard uses for the "send now" button.
 */
async function run({ force = false, now = new Date() } = {}) {
  const mtg = meeting();
  if (!mtg) return { sent: 0, reason: 'Kein Termin oder kein Zoom-Link hinterlegt.' };
  if (!force) {
    if (now < mtg.opensAt) return { sent: 0, reason: `Noch nicht fällig (ab ${mtg.opensAt.toISOString()}).` };
    if (now.getTime() > mtg.starts.getTime() + GRACE_AFTER_START_MS) return { sent: 0, reason: 'Termin liegt in der Vergangenheit.' };
  }

  const ids = reminderPackageIds();
  if (!ids.length) return { sent: 0, reason: 'Kein Paket mit Erinnerungstext konfiguriert.' };

  // Reset the record when the meeting time changed — a new meeting means everyone again.
  let record = settings.get('zoomSent') || { at: '', jids: [] };
  if (record.at !== mtg.at) record = { at: mtg.at, jids: [] };
  const already = new Set(record.jids);

  const recipients = new Map(); // jid → payment, newest booking wins
  for (const p of payments.all()) {
    if (p.status !== payments.STATUS.VERIFIED || !ids.includes(p.coachingId)) continue;
    if (already.has(p.jid)) continue;
    recipients.set(p.jid, p);
  }
  if (!recipients.size) return { sent: 0, reason: 'Alle haben den Link schon bekommen.' };

  if (!bot) return { sent: 0, failed: [], reason: 'Kein WhatsApp-Transport verbunden.' };

  let sent = 0;
  const failed = [];
  for (const [jid, payment] of recipients) {
    const customer = customers.get(jid);
    if (!customer) continue;
    const entry = getMenuEntry(payment.coachingId);
    const text = msgs.packageReminder(entry, { zoomlink: mtg.link, zeit: timeLabel(mtg.starts) });
    try {
      await bot.sendText(customer.replyJid || customer.jid, text);
      customers.logChat(customer, 'out', text);
      already.add(jid);
      sent++;
    } catch (err) {
      failed.push(`${customer.phone || jid}: ${err.message}`);
      log.warn(`Zoom link to ${customer.phone || jid} failed: ${err.message}`);
    }
    // Save after every send, so a crash mid-run cannot repeat the ones already delivered.
    settings.set('zoomSent', { at: mtg.at, jids: [...already] });
  }

  if (sent) log.info(`Zoom link sent to ${sent} customer(s) for the meeting on ${mtg.at}.`);
  return { sent, failed, reason: failed.length ? `${failed.length} konnten nicht erreicht werden.` : '' };
}

/** "19:30" in the configured time zone. */
function timeLabel(d) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Shares the transport with the conversation, so tests and the server wire it up once. */
function attach(b) {
  bot = b;
}

function start({ intervalMs = MINUTE } = {}) {
  stop();
  timer = setInterval(() => {
    run().catch((err) => log.error(`Zoom reminder failed: ${err.stack || err.message}`));
  }, intervalMs);
  timer.unref?.();
  log.info('Zoom reminder running (checks every minute).');
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { attach, start, stop, run, meeting, instantFromLocal, reminderPackageIds, LEAD_MS };
