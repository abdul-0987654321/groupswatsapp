'use strict';
/**
 * Dashboard API + pages. Generic "categories" (today: coachings; tomorrow maybe universities):
 * every category comes from config/coachings.json and gets a tile + detail page.
 */

const path = require('path');
const { coachings, getCoaching } = require('./config');
const payments = require('./payments');
const customers = require('./customers');
const conversation = require('./conversation');
const db = require('./storage/db');
const { readReceipt } = require('./receipt-reader');
const { verify, berlinDate } = require('./verify');
const { fingerprints } = require('./image-hash');

const CATEGORY_LABEL = process.env.CATEGORY_LABEL || 'Coaching';
const { STATUS } = payments;

const STATUS_INFO = {
  VERIFIED: { color: 'green', label: 'bestätigt' },
  NEEDS_REVIEW: { color: 'yellow', label: 'in Prüfung' },
  REJECTED: { color: 'red', label: 'abgelehnt' },
  SUPERSEDED: { color: 'grey', label: 'ersetzt' },
};

const paidAmount = (p) => (typeof p.amount === 'number' ? p.amount : p.expectedAmount || 0);
const monthOf = (p) => (p.paymentDate || berlinDate(new Date(p.receivedAt))).slice(0, 7);

function categoryStats(list, id) {
  const ps = list.filter((p) => p.coachingId === id);
  const verified = ps.filter((p) => p.status === STATUS.VERIFIED);
  const thisMonth = berlinDate(new Date()).slice(0, 7);
  return {
    members: new Set(verified.map((p) => p.jid)).size,
    revenue: round(verified.reduce((s, p) => s + paidAmount(p), 0)),
    revenueMonth: round(verified.filter((p) => monthOf(p) === thisMonth).reduce((s, p) => s + paidAmount(p), 0)),
    openReviews: ps.filter((p) => p.status === STATUS.NEEDS_REVIEW).length,
    rejected: ps.filter((p) => p.status === STATUS.REJECTED).length,
  };
}
const round = (n) => Math.round(n * 100) / 100;

function row(p) {
  const c = customers.get(p.jid);
  return {
    id: p.id,
    customerId: p.customerId || c?.id || '',
    name: p.name || customers.displayName(c),
    whatsappName: c?.pushName || '',
    phone: p.phone || c?.phone || '',
    coachingId: p.coachingId,
    coachingName: getCoaching(p.coachingId)?.name || p.coachingName || p.coachingId,
    amount: p.amount,
    expectedAmount: p.expectedAmount,
    paymentDate: p.paymentDate,
    receivedAt: p.receivedAt,
    status: p.status,
    statusColor: STATUS_INFO[p.status]?.color || 'grey',
    statusLabel: STATUS_INFO[p.status]?.label || p.status,
    reasons: p.reasons || [],
    linkSent: Boolean(p.linkSent),
  };
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const fileCache = new Map(); // small in-memory cache for screenshots fetched from Drive
async function getScreenshot(fileId) {
  if (fileCache.has(fileId)) return fileCache.get(fileId);
  const f = await db.getFile(fileId);
  fileCache.set(fileId, f);
  if (fileCache.size > 30) fileCache.delete(fileCache.keys().next().value);
  return f;
}

function mount(app) {
  const page = (file) => (req, res) => res.sendFile(path.join(__dirname, '..', 'public', file));
  app.get('/', page('index.html'));
  app.get('/kategorie/:id', page('kategorie.html'));
  app.get('/pruefungen', page('pruefungen.html'));
  app.get('/beleg-testen', page('beleg-testen.html'));

  // State-changing API calls must be JSON (blocks cross-site form posts).
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ ok: false, error: 'JSON erwartet' });
    next();
  });

  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  };

  app.get('/api/overview', wrap(() => {
    const list = payments.all();
    const categories = coachings.map((c) => ({ id: c.id, name: c.name, price: c.price, linkConfigured: Boolean(c.groupLink), ...categoryStats(list, c.id) }));
    const sum = (k) => round(categories.reduce((s, c) => s + c[k], 0));
    return {
      ok: true,
      categoryLabel: CATEGORY_LABEL,
      kpis: { members: sum('members'), revenue: sum('revenue'), revenueMonth: sum('revenueMonth'), openReviews: sum('openReviews') },
      categories,
    };
  }));

  app.get('/api/categories/:id', wrap((req) => {
    const c = getCoaching(req.params.id);
    if (!c) throw new Error(`${CATEGORY_LABEL} nicht gefunden`);
    const list = payments.all();
    return {
      ok: true,
      categoryLabel: CATEGORY_LABEL,
      category: { id: c.id, name: c.name, price: c.price, keywords: c.keywords, linkConfigured: Boolean(c.groupLink) },
      kpis: categoryStats(list, c.id),
      rows: list.filter((p) => p.coachingId === c.id && p.status !== STATUS.SUPERSEDED).map(row),
    };
  }));

  app.get('/api/categories/:id/export.csv', (req, res) => {
    const c = getCoaching(req.params.id);
    if (!c) return res.status(404).send('Nicht gefunden');
    const header = ['Zahlungs-ID', 'Kunden-ID', 'Name', 'Telefon', 'Betrag (EUR)', 'Erwartet (EUR)', 'Zahlungsdatum', 'Eingang', 'Status', 'Gründe', 'Link gesendet'];
    const lines = payments
      .all()
      .filter((p) => p.coachingId === c.id && p.status !== STATUS.SUPERSEDED)
      .map(row)
      .map((r) =>
        [
          r.id, r.customerId, r.name, r.phone,
          r.amount == null ? '' : String(r.amount).replace('.', ','), String(r.expectedAmount ?? '').replace('.', ','),
          r.paymentDate ? r.paymentDate.split('-').reverse().join('.') : '', r.receivedAt ? new Date(r.receivedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : '',
          r.statusLabel, r.reasons.join(' | '), r.linkSent ? 'ja' : 'nein',
        ].map(csvEscape).join(';')
      );
    const file = `${c.name.replace(/[^A-Za-z0-9]+/g, '_')}_${berlinDate(new Date())}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.send('﻿' + [header.join(';'), ...lines].join('\r\n')); // BOM + ";" so Excel (DE) opens it correctly
  });

  app.get('/api/reviews', wrap(() => ({
    ok: true,
    rows: payments.all().filter((p) => p.status === STATUS.NEEDS_REVIEW).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).map(row),
  })));

  app.get('/api/payments/:id', wrap((req) => {
    const p = payments.get(req.params.id);
    if (!p) throw new Error('Zahlung nicht gefunden');
    const c = customers.get(p.jid);
    return {
      ok: true,
      payment: { ...row(p), extracted: p.extracted, checks: p.checks || [], decidedAt: p.decidedAt, decidedBy: p.decidedBy, duplicateOf: p.duplicateOf, hasScreenshot: Boolean(p.screenshotFileId), mimeType: p.mimeType, supersededBy: p.supersededBy || null },
      customer: c ? { id: c.id, name: customers.displayName(c), pushName: c.pushName, phone: c.phone, stage: c.stage, createdAt: c.createdAt } : null,
      otherPayments: payments.forCustomer(p.jid).filter((x) => x.id !== p.id).map(row),
      chat: customers.chatHistory(p.jid).slice(-200),
    };
  }));

  app.get('/api/payments/:id/screenshot', async (req, res) => {
    const p = payments.get(req.params.id);
    if (!p?.screenshotFileId) return res.status(404).send('Kein Screenshot gespeichert');
    try {
      const f = await getScreenshot(p.screenshotFileId);
      res.setHeader('Content-Type', f.mimeType || p.mimeType || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(f.buffer);
    } catch (err) {
      res.status(502).send(`Screenshot konnte nicht geladen werden: ${err.message}`);
    }
  });

  app.post('/api/payments/:id/approve', wrap((req) => conversation.approvePayment(req.params.id)));
  app.post('/api/payments/:id/reject', wrap((req) => conversation.rejectPayment(req.params.id)));
  app.post('/api/payments/:id/resend-link', wrap((req) => conversation.resendLink(req.params.id)));

  // Test a receipt without creating a payment or messaging anyone.
  app.post('/api/test-receipt', wrap(async (req) => {
    const { coachingId, mimeType, base64 } = req.body || {};
    const coaching = getCoaching(coachingId);
    if (!coaching) throw new Error(`Bitte ${CATEGORY_LABEL} wählen`);
    if (!base64) throw new Error('Keine Datei');
    const buffer = Buffer.from(base64, 'base64');
    const type = mimeType === 'application/pdf' ? 'application/pdf' : mimeType || 'image/jpeg';
    const fp = await fingerprints(buffer, type);
    const extracted = await readReceipt(buffer, type);
    const result = verify(extracted, { coaching, receivedAt: new Date().toISOString(), imageHash: fp.imageHash, thumbnail: fp.thumbnail, previousPayments: db.all('payments') });
    return { ok: true, coaching: { id: coaching.id, name: coaching.name, price: coaching.price }, extracted, ...result };
  }));
}

module.exports = { mount, STATUS_INFO };
