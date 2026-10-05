'use strict';
/**
 * Coachings come from config/coachings.json (the only file you edit for names,
 * keywords, prices and group links). Bank details are fixed here and are never
 * produced by AI.
 */

const fs = require('fs');
const path = require('path');

const COACHINGS_FILE = path.join(__dirname, '..', 'config', 'coachings.json');

const BANK = Object.freeze({
  recipient: 'Ilyas Lang',
  iban: 'DE85 5505 0120 1200 6021 16',
  bic: 'MALADE51MNZ',
  bankName: 'Sparkasse Mainz',
});

const CURRENCY = 'EUR';

function loadCoachings() {
  const raw = JSON.parse(fs.readFileSync(COACHINGS_FILE, 'utf8'));
  const list = Object.entries(raw).map(([id, c]) => {
    if (!c.name || typeof c.price !== 'number') throw new Error(`config/coachings.json: "${id}" needs a name and a numeric price`);
    return {
      id,
      name: String(c.name),
      keywords: (c.keywords || []).map((k) => String(k).toLowerCase()),
      price: c.price,
      groupLink: String(c.groupLink || ''),
    };
  });
  if (!list.length) throw new Error('config/coachings.json has no coachings');
  return list;
}

const coachings = loadCoachings();

module.exports = {
  BANK,
  CURRENCY,
  coachings,
  getCoaching: (id) => coachings.find((c) => c.id === id) || null,
};
