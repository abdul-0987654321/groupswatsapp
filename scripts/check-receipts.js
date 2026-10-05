#!/usr/bin/env node
'use strict';
/**
 * Runs receipts through the real pipeline and prints a results table.
 *
 *   node scripts/check-receipts.js <folder-or-files…> [--coaching MAIN] [--received 2026-08-03T18:00:00+02:00]
 *       Reads every image/PDF with OpenAI (needs OPENAI_API_KEY), then runs all checks.
 *       Files are processed in order, so a repeated screenshot shows up as "Duplikat".
 *
 *   node scripts/check-receipts.js --fixtures receipts.json
 *       Skips OpenAI and checks already-extracted data:
 *       [{ "label": "...", "coaching": "MAIN", "receivedAt": "...", "file": "optional image path", "extracted": { … } }]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getCoaching } = require('../src/config');
const { readReceipt } = require('../src/receipt-reader');
const { verify } = require('../src/verify');
const { fingerprints } = require('../src/image-hash');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  const items = [];
  const fixtures = arg('--fixtures');
  if (fixtures) {
    for (const f of JSON.parse(fs.readFileSync(fixtures, 'utf8'))) items.push(f);
  } else {
    const inputs = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
    const files = inputs.flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).sort().map((f) => path.join(p, f)) : [p]));
    for (const file of files.filter((f) => MIME[path.extname(f).toLowerCase()])) {
      items.push({ label: path.basename(file), file, coaching: arg('--coaching') || 'MAIN', receivedAt: arg('--received') || new Date().toISOString() });
    }
  }
  if (!items.length) throw new Error('Keine Belege gefunden.');

  const previousPayments = [];
  const rows = [];
  for (const [i, item] of items.entries()) {
    const coaching = getCoaching(item.coaching);
    if (!coaching) throw new Error(`Unbekanntes Coaching ${item.coaching}`);
    const buffer = item.file ? fs.readFileSync(item.file) : null;
    const mimeType = item.file ? MIME[path.extname(item.file).toLowerCase()] : null;
    const fp = buffer ? await fingerprints(buffer, mimeType) : {};
    const extracted = item.extracted || (await readReceipt(buffer, mimeType));
    const r = verify(extracted, { coaching, receivedAt: item.receivedAt, imageHash: fp.imageHash, thumbnail: fp.thumbnail, previousPayments });
    const id = `T-${i + 1}`;
    previousPayments.push({ id, extracted, imageHash: fp.imageHash, thumbnail: fp.thumbnail, paymentDate: r.paymentDate, senderName: r.senderName, receivedAt: item.receivedAt });
    rows.push({ label: item.label, coaching: `${coaching.id} (${coaching.price} €)`, extracted, result: r });
  }

  for (const { label, coaching, extracted: e, result: r } of rows) {
    console.log(`\n=== ${label}  →  ${r.status}`);
    console.log(`  Coaching:      ${coaching}`);
    console.log(`  Bank/App:      ${e.bankApp ?? '–'}   Beleg: ${e.isPaymentReceipt}`);
    console.log(`  Empfänger:     ${e.recipientName ?? '–'} / ${e.recipientIban ?? '–'}`);
    console.log(`  Betrag:        ${e.amount ?? '–'} ${e.currency ?? ''}`);
    console.log(`  Datum:         ${e.date ?? '–'} ${e.time ?? ''}  → ${r.paymentDate ?? '–'}${r.dateWasRelative ? ' (relativ → Eingangsdatum)' : ''}`);
    console.log(`  Absender:      ${r.senderName ?? '–'}${!e.senderName && r.senderName ? ' (aus Verwendungszweck)' : ''}`);
    console.log(`  Zweck:         ${e.reference ?? '–'}`);
    console.log(`  Gründe:        ${r.reasons.length ? r.reasons.join(' | ') : '–'}`);
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
