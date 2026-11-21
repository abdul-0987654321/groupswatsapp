#!/usr/bin/env node
'use strict';
/**
 * Clears the trial/test data from the Google Sheet before going live.
 *
 *   node scripts/clear-trial-data.js              # dry run: only shows what would go
 *   node scripts/clear-trial-data.js --yes        # actually deletes
 *   node scripts/clear-trial-data.js --yes --tables customers,payments
 *
 * Empties the "customers", "payments" and "chat" tabs. Header rows stay, so the bot keeps
 * working. The "session" tab is NEVER touched — deleting it would log WhatsApp out and you
 * would have to scan the QR code again. "settings" is left alone too (bot language, admin
 * numbers, pause switch).
 *
 * Needs the same two values the bot uses, from Render → service → Environment:
 *   SHEET_WEBHOOK_URL=... SHEET_SECRET=... node scripts/clear-trial-data.js --yes
 *
 * Note: payment screenshots live in Google Drive, not in the Sheet. This removes the rows
 * that point at them; the image files stay in the Drive folder and can be deleted by hand.
 */

const { createSheetsBackend } = require('../src/storage/backend-sheets');

const PROTECTED = ['session', 'settings'];
const DEFAULT_TABLES = ['customers', 'payments', 'chat'];
const KEYS = { customers: 'jid', payments: 'id', chat: 'id' };

function parseArgs(argv) {
  const args = { yes: false, tables: DEFAULT_TABLES };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--yes') args.yes = true;
    else if (argv[i] === '--tables') args.tables = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*\*/, ''));
    return;
  }

  const bad = args.tables.filter((t) => PROTECTED.includes(t));
  if (bad.length) throw new Error(`Refusing to touch ${bad.join(', ')} — that would log WhatsApp out or reset your settings.`);
  const unknown = args.tables.filter((t) => !KEYS[t]);
  if (unknown.length) throw new Error(`Unknown tab(s): ${unknown.join(', ')}. Allowed: ${DEFAULT_TABLES.join(', ')}`);

  const backend = createSheetsBackend({ url: process.env.SHEET_WEBHOOK_URL, secret: process.env.SHEET_SECRET });

  console.log(`Reading ${args.tables.join(', ')} …`);
  const data = await backend.load(args.tables);

  const ops = [];
  let total = 0;
  for (const table of args.tables) {
    const rows = data[table] || [];
    const key = KEYS[table];
    const ids = rows.map((r) => r[key]).filter((v) => v !== undefined && v !== null && String(v) !== '');
    const skipped = rows.length - ids.length;
    console.log(`  ${table.padEnd(10)} ${String(rows.length).padStart(5)} rows` + (skipped ? `  (${skipped} without a "${key}" value — left alone)` : ''));
    total += ids.length;
    if (ids.length) ops.push({ table, key, remove: ids });
  }

  if (!total) {
    console.log('\nNothing to delete — the tabs are already empty.');
    return;
  }
  if (!args.yes) {
    console.log(`\nDRY RUN — nothing deleted. ${total} rows would go (headers stay, "session" untouched).`);
    console.log('Run it again with --yes to actually delete.');
    return;
  }

  console.log(`\nDeleting ${total} rows …`);
  // One table at a time, so a failure halfway is easy to read in the output.
  for (const op of ops) {
    await backend.write([op]);
    console.log(`  ${op.table}: ${op.remove.length} rows deleted`);
  }

  const after = await backend.load(args.tables);
  console.log('\nLeft in the sheet:');
  for (const table of args.tables) console.log(`  ${table.padEnd(10)} ${(after[table] || []).length} rows`);
  console.log('\nDone. The "session" tab was not touched, so WhatsApp stays connected.');
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
