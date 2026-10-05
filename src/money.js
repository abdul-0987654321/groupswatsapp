'use strict';
/** Amount formatting for customer messages and check reasons: "80 €", "80,50 €", "2 PKR". */

function formatMoney(n, currency = 'EUR', { decimals = 'auto' } = {}) {
  if (n == null || Number.isNaN(Number(n))) return '?';
  const num = Number(n);
  const fixed = decimals === 'auto' && Number.isInteger(num) ? String(num) : num.toFixed(2).replace('.', ',');
  return currency === 'EUR' ? `${fixed} €` : `${fixed} ${currency}`;
}

/** Maps what receipts print ("€", "Rs.", "Rupees") to ISO codes. */
function normalizeCurrency(c) {
  const s = String(c || '').trim().toUpperCase().replace(/\./g, '');
  if (!s) return null;
  if (s === '€' || s === 'EURO' || s === 'EUR') return 'EUR';
  if (['RS', 'PKR', 'RUPEES', 'RUPEE', 'PKRS'].includes(s)) return 'PKR';
  if (s === '$' || s === 'USD') return 'USD';
  return s;
}

module.exports = { formatMoney, normalizeCurrency };
