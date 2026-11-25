'use strict';
/**
 * All texts the bot sends, in German (default) and English. The language is chosen in the
 * dashboard (WhatsApp page → "Bot-Sprache"). Prices, bank details and links are filled in by
 * code from config — AI never writes any of these.
 */

const { BANK, CURRENCY } = require('./config');
const settings = require('./settings');
const { formatMoney } = require('./money');

const price = (c) => formatMoney(c.price, CURRENCY);
// Account line: IBAN for the live account, account number (+ bank) for e.g. a Pakistani test account
const accountLines = (lang) =>
  BANK.accountType === 'iban'
    ? `IBAN: ${BANK.account}\n`
    : `${lang === 'de' ? 'Kontonummer' : 'Account number'}: ${BANK.account}\n` + (BANK.bankName ? `Bank: ${BANK.bankName}\n` : '');

/** "1. Probestunde – 5 €" plus an optional note line. Prices always come from config. */
const menuOptions = (menu, lang) =>
  menu.options
    .map((o, i) => `${i + 1}. ${o.label[lang]} – ${price(o.coaching)}` + (o.note?.[lang] ? `\n   (${o.note[lang]})` : ''))
    .join('\n');

/**
 * A package may override the menu's wording; otherwise the menu's own text is used.
 *
 * Placeholders are filled from config, never typed into menus.json: {recipient}, {iban},
 * {bic}, {bank}, {paket} (the menu number), {preis}. Bank details in particular MUST come
 * from config/payment.json — the same values verify.js checks the receipt against. A hand-
 * typed IBAN in the message would be shown to customers while payments were verified against
 * a different one, and every single transfer would fail as "Empfänger-IBAN stimmt nicht".
 */
const packageText = (entry, lang, key, extra = {}) => {
  const raw = entry.option.texts[lang]?.[key] || entry.menu.texts[lang]?.[key] || '';
  const vars = {
    recipient: BANK.recipient,
    iban: BANK.account,
    account: BANK.account,
    bic: BANK.bic || '',
    bank: BANK.bankName || '',
    paket: String(entry.option.number),
    preis: price(entry.option.coaching),
    price: price(entry.option.coaching),
    ...extra,
  };
  return String(raw).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
};

const TEXTS = {
  de: {
    welcome: () => 'Willkommen! Für welches Coaching interessierst du dich?',
    askCoaching: () => 'Für welches Coaching interessierst du dich?',
    price: (c) =>
      `Das ${c.name} kostet ${price(c)}. Bitte überweise an:\n` +
      `Empfänger: ${BANK.recipient}\n` +
      accountLines('de') +
      `Verwendungszweck: Dein Name + ${c.name}\n` +
      `Schick mir danach einen Screenshot deiner Überweisung.`,
    remindScreenshot: (c) =>
      `Du hast das ${c.name} gewählt (${price(c)}). Bitte schick mir einen Screenshot deiner Überweisung (als Bild oder PDF), damit ich die Zahlung prüfen kann.\n` +
      'Möchtest du ein anderes Coaching? Schreib mir einfach, welches.',
    changeCoaching: () => 'Kein Problem! Für welches Coaching interessierst du dich?',
    confirmCoaching: (c) => `Meinst du das ${c.name}? Antworte bitte mit Ja oder Nein.`,
    afterNo: () => 'Alles klar! Für welches Coaching interessierst du dich dann?',
    notOffered: () => 'Dieses Coaching bieten wir leider nicht an. 🙏 Schreib mir bitte den Namen des Coachings, für das du dich interessierst.',
    askCoachingHint: () => 'Schreib mir einfach den Namen des Coachings, so wie er in der Anzeige oder in der Gruppe stand. 😊',
    askCoachingHelp: () => 'Ich habe leider noch nicht verstanden, welches Coaching du meinst. Wie hieß das Coaching in der Anzeige?',
    askAnotherCoaching: () => 'Gerne! Für welches weitere Coaching interessierst du dich? (Dein bisheriger Gruppenlink bleibt gültig.)',
    youreWelcome: () => 'Gerne! 😊 Wenn du noch etwas brauchst, schreib mir einfach.',
    verified: (c) => `Zahlung bestätigt ✅ Hier ist dein Link zur Coaching-Gruppe: ${c.groupLink}`,
    verifiedLinkPending: () => 'Zahlung bestätigt ✅ Den Link zur Coaching-Gruppe bekommst du in Kürze.',
    alreadyVerified: (c) =>
      `Du bist bereits für das ${c.name} freigeschaltet ✅ Hier ist dein Link zur Coaching-Gruppe: ${c.groupLink}\n` +
      'Möchtest du ein weiteres Coaching? Schreib mir einfach, welches.',
    inReview: () => 'Danke! Deine Zahlung wird kurz geprüft. Du bekommst gleich Bescheid.',
    stillInReview: () => 'Deine Zahlung wird gerade noch geprüft. Du bekommst gleich Bescheid.',
    rejected: () => 'Leider konnten wir deine Zahlung nicht bestätigen. Bitte schick uns einen gültigen Überweisungsbeleg.',
    imageUnreadable: () => 'Ich konnte die Datei leider nicht öffnen. Bitte schick den Screenshot noch einmal.',
    // Package menus (config/menus.json): wording comes from the config file, the numbered list and prices from code.
    packageMenu: (menu) => `${menu.texts.de.intro}\n\n${menuOptions(menu, 'de')}`,
    packageMenuRetry: (menu) => `${menu.texts.de.retry || menu.texts.de.intro}\n\n${menuOptions(menu, 'de')}`,
    packageRequestReceipt: (entry) => packageText(entry, 'de', 'requestReceipt'),
    packageVerified: (entry, c) => `${packageText(entry, 'de', 'verified')}${c.groupLink ? `\n\n${c.groupLink}` : ''}`,
    packageReminder: (entry, extra) => packageText(entry, 'de', 'reminder', extra),
  },
  en: {
    welcome: () => 'Welcome! Which coaching are you interested in?',
    askCoaching: () => 'Which coaching are you interested in?',
    price: (c) =>
      `The ${c.name} costs ${price(c)}. Please transfer to:\n` +
      `Recipient: ${BANK.recipient}\n` +
      accountLines('en') +
      `Reference: Your name + ${c.name}\n` +
      `Then send me a screenshot of your transfer.`,
    remindScreenshot: (c) =>
      `You chose the ${c.name} (${price(c)}). Please send me a screenshot of your transfer (as an image or PDF) so I can check the payment.\n` +
      'Would you like a different coaching? Just tell me which one.',
    changeCoaching: () => 'No problem! Which coaching are you interested in?',
    confirmCoaching: (c) => `Do you mean the ${c.name}? Please answer Yes or No.`,
    afterNo: () => 'Alright! Which coaching are you interested in then?',
    notOffered: () => "Sorry, we don't offer that coaching. 🙏 Please tell me the name of the coaching you are interested in.",
    askCoachingHint: () => 'Just write me the name of the coaching as it was shown in the ad or in the group. 😊',
    askCoachingHelp: () => "Sorry, I didn't quite get which coaching you mean yet. What was the coaching called in the ad?",
    askAnotherCoaching: () => 'Sure! Which other coaching are you interested in? (Your current group link stays valid.)',
    youreWelcome: () => "You're welcome! 😊 If you need anything else, just write me.",
    verified: (c) => `Payment confirmed ✅ Here is your link to the coaching group: ${c.groupLink}`,
    verifiedLinkPending: () => 'Payment confirmed ✅ You will receive the link to the coaching group shortly.',
    alreadyVerified: (c) =>
      `You are already unlocked for the ${c.name} ✅ Here is your link to the coaching group: ${c.groupLink}\n` +
      'Would you like another coaching? Just tell me which one.',
    inReview: () => 'Thank you! Your payment is being checked. You will hear from us shortly.',
    stillInReview: () => 'Your payment is still being checked. You will hear from us shortly.',
    rejected: () => 'Unfortunately we could not confirm your payment. Please send us a valid transfer receipt.',
    imageUnreadable: () => 'Sorry, I could not open the file. Please send the screenshot again.',
    packageMenu: (menu) => `${menu.texts.en.intro}\n\n${menuOptions(menu, 'en')}`,
    packageMenuRetry: (menu) => `${menu.texts.en.retry || menu.texts.en.intro}\n\n${menuOptions(menu, 'en')}`,
    packageRequestReceipt: (entry) => packageText(entry, 'en', 'requestReceipt'),
    packageVerified: (entry, c) => `${packageText(entry, 'en', 'verified')}${c.groupLink ? `\n\n${c.groupLink}` : ''}`,
    packageReminder: (entry, extra) => packageText(entry, 'en', 'reminder', extra),
  },
};

// Each message is looked up in the current bot language at the moment it is sent.
module.exports = Object.fromEntries(
  Object.keys(TEXTS.de).map((name) => [name, (...args) => (TEXTS[settings.get('botLanguage')] || TEXTS.de)[name](...args)])
);
module.exports.TEXTS = TEXTS;
