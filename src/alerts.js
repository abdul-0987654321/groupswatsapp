'use strict';
/**
 * WhatsApp alerts to the admin number(s) set in the dashboard:
 *  - a receipt needs review (NEEDS_REVIEW)
 *  - a customer was confirmed automatically and got the group link
 * Alerts run in the background and never delay or break the customer conversation.
 * Tip: write the bot once from the admin phone so the chat exists.
 */

const log = require('./log');
const settings = require('./settings');
const { getCoaching, CURRENCY } = require('./config');
const { formatMoney } = require('./money');

let bot = null;

function setBot(b) {
  bot = b;
}

function adminNumbers() {
  return settings.get('adminNumbers') || [];
}

/** Messages from admin numbers are not treated as customers. */
function isAdmin(jid) {
  const digits = String(jid || '').split('@')[0].split(':')[0];
  return Boolean(digits) && adminNumbers().includes(digits);
}

function dashboardUrl(path) {
  const base = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  return base ? base + path : '';
}

function describe(payment, customer, de) {
  const c = getCoaching(payment.coachingId);
  const who = [payment.name || customer?.pushName, customer?.phone || payment.phone].filter(Boolean).join(' – ');
  const amount = payment.amount == null ? '?' : formatMoney(payment.amount, payment.expectedCurrency || CURRENCY);
  return (
    `${de ? 'Kunde' : 'Customer'}: ${who || '?'}\n` +
    `Coaching: ${c?.name || payment.coachingId} (${formatMoney(payment.expectedAmount, payment.expectedCurrency || CURRENCY)})\n` +
    `${de ? 'Betrag laut Beleg' : 'Amount on receipt'}: ${amount}\n` +
    `${de ? 'Zahlung' : 'Payment'}: ${payment.id}`
  );
}

function buildText(kind, payment, customer) {
  const de = settings.get('botLanguage') !== 'en';
  if (kind === 'review') {
    const url = dashboardUrl('/pruefungen');
    return (
      (de ? '⚠️ Neue Zahlung zur Prüfung\n' : '⚠️ New payment to review\n') +
      describe(payment, customer, de) +
      `\n${de ? 'Gründe' : 'Reasons'}: ${(payment.reasons || []).join(' | ') || '–'}` +
      (url ? `\n${de ? 'Bitte prüfen' : 'Please check'}: ${url}` : '')
    );
  }
  const url = dashboardUrl(`/kategorie/${encodeURIComponent(payment.coachingId)}`);
  return (
    (de ? '✅ Zahlung bestätigt – Gruppenlink gesendet\n' : '✅ Payment confirmed – group link sent\n') +
    describe(payment, customer, de) +
    (url ? `\nDashboard: ${url}` : '')
  );
}

/** kind: 'review' | 'verified'. Fire-and-forget. */
function notify(kind, payment, customer) {
  if (kind === 'review' && !settings.get('alertOnReview')) return;
  if (kind === 'verified' && !settings.get('alertOnVerified')) return;
  const numbers = adminNumbers();
  if (!numbers.length || !bot) return;
  const text = buildText(kind, payment, customer);
  for (const n of numbers) {
    bot.sendText(`${n}@s.whatsapp.net`, text).catch((err) => log.warn(`Admin alert to +${n} failed: ${err.message}`));
  }
}

async function sendTest() {
  const numbers = adminNumbers();
  if (!numbers.length) throw new Error('Keine Admin-Nummer eingetragen.');
  if (!bot?.isConnected()) throw new Error('WhatsApp ist nicht verbunden.');
  const de = settings.get('botLanguage') !== 'en';
  const text = de ? '🔔 Test: Admin-Benachrichtigungen vom Coaching-Bot funktionieren.' : '🔔 Test: admin alerts from the coaching bot are working.';
  await Promise.all(numbers.map((n) => bot.sendText(`${n}@s.whatsapp.net`, text)));
  return { ok: true, sentTo: numbers.map((n) => '+' + n) };
}

module.exports = { setBot, isAdmin, notify, sendTest, buildText, adminNumbers };
