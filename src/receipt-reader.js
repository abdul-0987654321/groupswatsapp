'use strict';
/**
 * Reads a payment receipt (screenshot or PDF) with OpenAI vision and returns strict JSON:
 * the printed fields plus the AI's own judgement (completed? to our account? edited?).
 * The AI never decides alone — verify.js combines its judgement with checks in code.
 */

const sharp = require('sharp');
const ai = require('./ai');

const FIELDS = [
  'isPaymentReceipt', 'recipientName', 'recipientIban', 'amount', 'currency', 'date', 'time', 'senderName', 'reference', 'bankApp',
  'transferCompleted', 'recipientIsExpected', 'suspicious', 'aiNotes',
];

const SCHEMA = {
  name: 'payment_receipt',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: FIELDS,
    properties: {
      isPaymentReceipt: { type: 'boolean' },
      recipientName: { type: ['string', 'null'] },
      recipientIban: { type: ['string', 'null'] },
      amount: { type: ['number', 'null'] },
      currency: { type: ['string', 'null'] },
      date: { type: ['string', 'null'] },
      time: { type: ['string', 'null'] },
      senderName: { type: ['string', 'null'] },
      reference: { type: ['string', 'null'] },
      bankApp: { type: ['string', 'null'] },
      transferCompleted: { type: ['boolean', 'null'] },
      recipientIsExpected: { type: ['boolean', 'null'] },
      suspicious: { type: 'boolean' },
      aiNotes: { type: ['string', 'null'] },
    },
  },
};

const PROMPT = `Du liest einen Überweisungsbeleg (Screenshot einer Banking-App, Online-Banking-Seite oder PDF-Auftragsbestätigung). Mögliche Banken/Apps: Sparkasse, Volksbank, ING, Revolut, MLP, N26, DKB, Commerzbank, Deutsche Bank, PayPal sowie pakistanische Apps wie Easypaisa, JazzCash, NayaPay, SadaPay, Meezan, HBL, UBL u. a. Sprache Deutsch, Englisch oder Urdu, heller oder dunkler Modus.

Gib NUR die Felder des JSON-Schemas zurück. Regeln:
- isPaymentReceipt: true nur, wenn das Bild eine ausgeführte oder beauftragte Überweisung/Zahlung zeigt (z. B. "Überweisung", "Auftragsbestätigung", "erfolgreich", "Transaction details", "The transfer was completed", Umsatzdetails). Sonst false (z. B. Selfie, Chat, Werbung, leere Überweisungsmaske).
- recipientName: der EMPFÄNGER des Geldes (Felder wie "Empfänger", "Zahlungsbeteiligter", "Name" bei einer Abbuchung, Überschrift oben bei Revolut). NICHT der Auftraggeber/Kontoinhaber.
- recipientIban: IBAN, Kontonummer, Wallet- oder Handynummer des EMPFÄNGERS genau wie gedruckt (z. B. "DE85 5505 …", "PK36 SCBL …", "0337 1456781", "****6781"). Nicht die Nummer des Auftraggebers/Kontoinhabers.
- amount: Betrag als positive Zahl (z. B. "-90 €" → 90, "5,00 EUR" → 5, "Rs. 1.00" → 1). Gebühren nicht mitzählen.
- currency: ISO-Code, z. B. "EUR"; "Rs"/"Rupees" → "PKR".
- date: Ausführungs-/Buchungsdatum. Wenn ein absolutes Datum sichtbar ist, im Format YYYY-MM-DD. Wenn nur ein relatives Datum sichtbar ist, gib das Wort genau wie gedruckt zurück (z. B. "Heute", "Today", "Gestern", "A few minutes ago"). Nicht das Datum aus dem Verwendungszweck verwenden, wenn ein anderes Buchungsdatum sichtbar ist. Ansonsten null.
- time: Uhrzeit HH:MM, falls sichtbar, sonst null.
- senderName: der AUFTRAGGEBER/Absender (z. B. "Auftraggeber", "Kontoinhaber"), falls sichtbar, sonst null.
- reference: Verwendungszweck/Reason/Reference genau wie gedruckt, sonst null.
- reference: bei pakistanischen Apps auch "Purpose"/"Description"/"Message", falls vorhanden. Eine Transaktions-ID (TID, Transaction ID) NICHT als reference, sondern in reference nur, wenn kein Verwendungszweck existiert – dann im Format "TID <nummer>".
- bankApp: Name der Bank oder App, die den Beleg erzeugt hat (z. B. "Sparkasse", "Volksbank", "Revolut", "MLP", "ING", "Easypaisa", "JazzCash"), sonst null.
- Pakistanische Belege: "Sent to", "Destination Acc. Title", "To", "Receiver" = EMPFÄNGER; "Sent by", "Source Acc. Title", "From", "Funding Source" = ABSENDER. Raast-IBAN/Kontonummer unter "Sent to"/"Destination" ist recipientIban.
- Wörter für den Überweisungsweg wie "RAAST", "IBFT", "FT", "P2P", "Fund Transfer", "EBPL", "SEPA", "Echtzeitüberweisung" sind NIE ein Name – nicht als senderName/recipientName verwenden.
- Gutschrift-/Kontoauszugsbelege ("Amount Credited", "Gutschrift", Buchungstext mit zwei Namen/IBANs): das Konto, dem gutgeschrieben wurde, ist der EMPFÄNGER; der andere Name in der Buchungszeile ist der ABSENDER.
- Transaktions-IDs, Referenznummern und Kontonummern Zeichen für Zeichen exakt abschreiben – keine Ziffer doppelt oder auslassen.
- Erfinde nichts. Unleserliche oder fehlende Felder → null.

Zusätzlich deine eigene Einschätzung (die Prüfung im Code entscheidet am Ende, sei ehrlich und vorsichtig):
- transferCompleted: true, wenn die Zahlung als erfolgreich/ausgeführt/abgeschlossen angezeigt wird ("Successful", "Completed", "erfolgreich", "ausgeführt", gebucht). false bei "Pending", "Failed", "In Bearbeitung", "Vorgemerkt" mit Fehler, abgebrochen oder nur einer Eingabemaske. null, wenn nicht erkennbar.
- recipientIsExpected: Vergleiche den Empfänger auf dem Beleg mit den ERWARTETEN Empfängerkonten (siehe Nachricht). true, wenn Name UND – falls sichtbar – Kontonummer/IBAN (auch teilweise maskiert, z. B. letzte Ziffern) dazu passen. false, wenn eine sichtbare Nummer oder der Name eindeutig nicht passt (z. B. andere Bank/andere Endziffern). null, wenn nicht entscheidbar.
- suspicious: true, wenn der Beleg bearbeitet, zusammengesetzt, unscharf manipuliert oder unlogisch wirkt (z. B. Schriftarten passen nicht, Betrag überklebt, Datum/Uhrzeit widersprüchlich, Summe passt nicht zu Betrag + Gebühr). Sonst false.
- aiNotes: kurzer Hinweis auf Deutsch (max. 1 Satz), z. B. warum etwas nicht passt. null, wenn alles unauffällig ist.`;

function expectationText(expected) {
  if (!expected) return 'Lies diesen Beleg aus.';
  const accs = (expected.accounts || [])
    .map((a) => `- ${a.recipient}, Konto/IBAN ${a.account}${a.bankName ? ', ' + a.bankName : ''}`)
    .join('\n');
  return (
    'Lies diesen Beleg aus und beurteile ihn.\n' +
    `Erwartete Empfängerkonten:\n${accs}\n` +
    `Erwarteter Betrag: ${expected.amount} ${expected.currency}\n` +
    'Wichtig: Gib die Felder trotzdem genau so zurück, wie sie auf dem Beleg stehen – nicht die erwarteten Werte.'
  );
}

async function toModelInput(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    return { type: 'file', file: { filename: 'beleg.pdf', file_data: `data:application/pdf;base64,${buffer.toString('base64')}` } };
  }
  const jpeg = await sharp(buffer).rotate().resize({ width: 1600, height: 3200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'high' } };
}

/**
 * @param expected { accounts: [{recipient, account, bankName}], amount, currency } – what we expect to see
 */
async function readReceipt(buffer, mimeType = 'image/jpeg', expected = null) {
  const client = ai.getClient();
  if (!client) throw new Error('OPENAI_API_KEY ist nicht gesetzt');
  const res = await client.chat.completions.create({
    model: ai.MODEL,
    temperature: 0,
    max_tokens: 500,
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: [{ type: 'text', text: expectationText(expected) }, await toModelInput(buffer, mimeType)] },
    ],
  });
  const raw = res.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  const out = {};
  for (const f of FIELDS) out[f] = parsed[f] ?? null;
  out.isPaymentReceipt = parsed.isPaymentReceipt === true;
  out.suspicious = parsed.suspicious === true;
  if (typeof out.amount === 'string') out.amount = Number(String(out.amount).replace(/\./g, '').replace(',', '.')) || null;
  if (typeof out.amount === 'number') out.amount = Math.abs(out.amount);
  return out;
}

module.exports = { readReceipt, FIELDS };
