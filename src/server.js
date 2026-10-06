'use strict';
require('dotenv').config();
process.env.TZ = process.env.TZ || 'Europe/Berlin';

const path = require('path');
const express = require('express');
const log = require('./log');
const db = require('./storage/db');
const { createSheetsBackend } = require('./storage/backend-sheets');
const { createMemoryBackend } = require('./storage/backend-memory');
const bot = require('./bot');
const auth = require('./auth');
const conversation = require('./conversation');

const PORT = Number(process.env.PORT || 3000);
const startedAt = new Date().toISOString();
const state = { ready: false, storageError: null, storageWarning: null };

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' })); // receipt test upload sends the file as base64
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false, extensions: [] })); // static shells only; all data is behind /api + login

// ---- Health check for Render + UptimeRobot (no login, always 200 while the process runs) ----
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    startedAt,
    ready: state.ready,
    whatsapp: bot.getStatus().status,
    storage: db.status(),
  });
});

// ---- Login ----
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));
app.post('/login', async (req, res) => {
  const result = await auth.login(req, res);
  if (result === 'ok') return res.redirect('/');
  return res.redirect(result === 'locked' ? '/login?gesperrt=1' : '/login?fehler=1');
});
app.post('/logout', (req, res) => {
  auth.logout(res);
  res.redirect('/login');
});

// ---- Everything below requires login ----
app.use(auth.requireLogin);

app.get('/api/whatsapp', (req, res) => {
  res.json({ ok: true, ready: state.ready, storageError: state.storageError, storageWarning: state.storageWarning, storage: db.status(), ...bot.getStatus() });
});
app.post('/api/whatsapp/connect', async (req, res) => res.json(await bot.start()));
app.post('/api/whatsapp/relink', async (req, res) => res.json(await bot.logoutAndRelink()));
const settings = require('./settings');
const { MODE, BANK, ACCOUNTS, CURRENCY, coachings } = require('./config');
app.get('/api/settings', (req, res) =>
  res.json({
    ok: true,
    settings: settings.all(),
    mode: MODE,
    currency: CURRENCY,
    account: { recipient: BANK.recipient, account: BANK.account, bankName: BANK.bankName },
    accounts: ACCOUNTS.map((a) => ({ recipient: a.recipient, account: a.account, bankName: a.bankName })),
    prices: coachings.map((c) => ({ id: c.id, name: c.name, price: c.price, hasLink: Boolean(c.groupLink) })),
    password: auth.passwordInfo(),
  })
);
app.post('/api/settings', (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!settings.PUBLIC.includes(k)) throw new Error(`Einstellung ${k} kann hier nicht geändert werden.`);
      settings.set(k, v);
    }
    res.json({ ok: true, settings: settings.all() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});
app.post('/api/password', (req, res) => {
  try {
    res.json(auth.changePassword(req, res));
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});
// Everything the top bar needs in one request
app.get('/api/summary', (req, res) => {
  const wa = bot.getStatus();
  res.json({
    ok: true,
    whatsapp: { status: wa.status, connected: wa.connected, me: wa.me },
    botEnabled: settings.get('botEnabled') !== false,
    mode: MODE,
    currency: CURRENCY,
    account: { recipient: BANK.recipient, account: BANK.account, bankName: BANK.bankName },
    openReviews: require('./payments').all().filter((p) => p.status === 'NEEDS_REVIEW').length,
    adminNumbers: (settings.get('adminNumbers') || []).length,
    storageError: state.storageError || db.status().lastFlushError || null,
    storageWarning: state.storageWarning,
  });
});
app.post('/api/whatsapp/pairing-code', async (req, res) => {
  try {
    res.json({ ok: true, ...(await bot.requestPairingCode(req.body?.phone)) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

const page = (file) => (req, res) => res.sendFile(path.join(__dirname, '..', 'public', file));
app.get('/whatsapp', page('whatsapp.html'));
app.get('/einstellungen', page('einstellungen.html'));
require('./dashboard').mount(app);

// ---- Startup ----
async function boot() {
  let backend;
  if (process.env.SHEET_WEBHOOK_URL) {
    try {
      backend = createSheetsBackend({ url: process.env.SHEET_WEBHOOK_URL, secret: process.env.SHEET_SECRET });
    } catch (err) {
      state.storageError = `Google Sheet nicht erreichbar: ${err.message} – bitte in Render setzen.`;
      log.error(state.storageError);
      return; // dashboard + /health keep running and show the error
    }
  } else {
    state.storageWarning =
      'SHEET_WEBHOOK_URL ist nicht gesetzt – Daten werden nur im Arbeitsspeicher gehalten und gehen beim Neustart verloren.';
    log.warn(state.storageWarning);
    backend = createMemoryBackend();
  }

  // Keep retrying until the storage is reachable — never start WhatsApp without the stored session.
  for (let attempt = 1; ; attempt++) {
    try {
      await db.init(backend);
      state.storageError = null;
      break;
    } catch (err) {
      state.storageError = `Google Sheet nicht erreichbar: ${err.message}`;
      log.error(`${state.storageError} (attempt ${attempt}, retrying in 15s)`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }

  conversation.attach(bot);
  state.ready = true;

  // On a Render deploy the old instance keeps running until this one is healthy, then gets SIGTERM
  // and saves its last WhatsApp session changes. Wait for that, re-read the session, then connect —
  // so a deploy never loses the login.
  const { hasSession } = require('./storage/auth-state');
  const delay = Number(process.env.WHATSAPP_START_DELAY_MS ?? (process.env.RENDER ? 25000 : 0));
  if (delay > 0 && hasSession()) {
    log.info(`Waiting ${delay / 1000}s for the previous instance to hand over the WhatsApp session…`);
    await new Promise((r) => setTimeout(r, delay));
    try {
      await db.reload(['session']);
    } catch (err) {
      log.warn(`Re-reading the session failed, using the one loaded at startup: ${err.message}`);
    }
  }
  await bot.start();
}

const server = app.listen(PORT, () => {
  log.info(`Server listening on port ${PORT}`);
  if (!process.env.DASHBOARD_PASSWORD) log.warn('DASHBOARD_PASSWORD is not set — dashboard login is disabled.');
  void boot();
});

// Render sends SIGTERM on deploy/restart: save everything that is still queued, then exit.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received — saving data and shutting down.`);
  server.close();
  await bot.stop();
  try {
    await db.flush();
    log.info('All data saved.');
  } catch (err) {
    log.error(`Final save failed: ${err.message}`);
  }
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error(`Unhandled rejection: ${err?.stack || err}`));

module.exports = { app };
