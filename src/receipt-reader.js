'use strict';
/**
 * Reads a payment receipt (screenshot or PDF) with OpenAI vision and returns the fields
 * as strict JSON. The AI only extracts what is printed — all decisions are made in verify.js.
 */

const sharp = require('sharp');
const ai = require('./ai');

const FIELDS = ['isPaymentReceipt', 'recipientName', 'recipientIban', 'amount', 'currency', 'date', 'time', 'senderName', 'reference', 'bankApp'];

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
    },
  },
};

const PROMPT = `Du liest einen Überweisungsbeleg (Screenshot einer Banking-App, Online-Banking-Seite oder PDF-Auftragsbestätigung) aus Deutschland/Europa. Mögliche Banken: Sparkasse, Volksbank, ING, Revolut, MLP, N26, DKB, Commerzbank, Deutsche Bank, PayPal u. a. Sprache Deutsch oder Englisch, heller oder dunkler Modus.

Gib NUR die Felder des JSON-Schemas zurück. Regeln:
- isPaymentReceipt: true nur, wenn das Bild eine ausgeführte oder beauftragte Überweisung/Zahlung zeigt (z. B. "Überweisung", "Auftragsbestätigung", "erfolgreich", "Transaction details", "The transfer was completed", Umsatzdetails). Sonst false (z. B. Selfie, Chat, Werbung, leere Überweisungsmaske).
- recipientName: der EMPFÄNGER des Geldes (Felder wie "Empfänger", "Zahlungsbeteiligter", "Name" bei einer Abbuchung, Überschrift oben bei Revolut). NICHT der Auftraggeber/Kontoinhaber.
- recipientIban: IBAN des Empfängers genau wie gedruckt (Leerzeichen egal). Nicht die IBAN des Auftraggebers/Kontoinhabers.
- amount: Betrag als positive Zahl (z. B. "-90 €" → 90, "5,00 EUR" → 5).
- currency: ISO-Code, z. B. "EUR".
- date: Ausführungs-/Buchungsdatum. Wenn ein absolutes Datum sichtbar ist, im Format YYYY-MM-DD. Wenn nur ein relatives Datum sichtbar ist, gib das Wort genau wie gedruckt zurück (z. B. "Heute", "Today", "Gestern", "A few minutes ago"). Nicht das Datum aus dem Verwendungszweck verwenden, wenn ein anderes Buchungsdatum sichtbar ist. Ansonsten null.
- time: Uhrzeit HH:MM, falls sichtbar, sonst null.
- senderName: der AUFTRAGGEBER/Absender (z. B. "Auftraggeber", "Kontoinhaber"), falls sichtbar, sonst null.
- reference: Verwendungszweck/Reason/Reference genau wie gedruckt, sonst null.
- bankApp: Name der Bank oder App, die den Beleg erzeugt hat (z. B. "Sparkasse", "Volksbank", "Revolut", "MLP", "ING"), sonst null.
- Erfinde nichts. Unleserliche oder fehlende Felder → null.`;

async function toModelInput(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    return { type: 'file', file: { filename: 'beleg.pdf', file_data: `data:application/pdf;base64,${buffer.toString('base64')}` } };
  }
  const jpeg = await sharp(buffer).rotate().resize({ width: 1600, height: 3200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'high' } };
}

async function readReceipt(buffer, mimeType = 'image/jpeg') {
  const client = ai.getClient();
  if (!client) throw new Error('OPENAI_API_KEY ist nicht gesetzt');
  const res = await client.chat.completions.create({
    model: ai.MODEL,
    temperature: 0,
    max_tokens: 500,
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: [{ type: 'text', text: 'Lies diesen Beleg aus.' }, await toModelInput(buffer, mimeType)] },
    ],
  });
  const raw = res.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  const out = {};
  for (const f of FIELDS) out[f] = parsed[f] ?? null;
  out.isPaymentReceipt = parsed.isPaymentReceipt === true;
  if (typeof out.amount === 'string') out.amount = Number(String(out.amount).replace(/\./g, '').replace(',', '.')) || null;
  if (typeof out.amount === 'number') out.amount = Math.abs(out.amount);
  return out;
}

module.exports = { readReceipt, FIELDS };
