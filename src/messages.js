'use strict';
/**
 * All texts the bot sends (German). Prices, bank details and links are filled in by
 * code from config — AI never writes any of these.
 */

const { BANK } = require('./config');

const euro = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));

module.exports = {
  welcome: () => 'Willkommen! Für welches Coaching interessierst du dich?',
  askCoaching: () => 'Für welches Coaching interessierst du dich?',
  price: (c) =>
    `Das ${c.name} kostet ${euro(c.price)} €. Bitte überweise an:\n` +
    `Empfänger: ${BANK.recipient}\n` +
    `IBAN: ${BANK.iban}\n` +
    `Verwendungszweck: Dein Name + ${c.name}\n` +
    `Schick mir danach einen Screenshot deiner Überweisung.`,
  remindScreenshot: () =>
    'Bitte schick mir einen Screenshot deiner Überweisung (als Bild oder PDF), damit ich die Zahlung prüfen kann.',
  verified: (c) => `Zahlung bestätigt ✅ Hier ist dein Link zur Coaching-Gruppe: ${c.groupLink}`,
  verifiedLinkPending: () =>
    'Zahlung bestätigt ✅ Den Link zur Coaching-Gruppe bekommst du in Kürze.',
  alreadyVerified: (c) => `Du bist bereits freigeschaltet ✅ Hier ist dein Link zur Coaching-Gruppe: ${c.groupLink}`,
  inReview: () => 'Danke! Deine Zahlung wird kurz geprüft. Du bekommst gleich Bescheid.',
  stillInReview: () => 'Deine Zahlung wird gerade noch geprüft. Du bekommst gleich Bescheid.',
  rejected: () =>
    'Leider konnten wir deine Zahlung nicht bestätigen. Bitte schick uns einen gültigen Überweisungsbeleg.',
  imageUnreadable: () => 'Ich konnte die Datei leider nicht öffnen. Bitte schick den Screenshot noch einmal.',
};
