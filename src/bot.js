'use strict';
/**
 * WhatsApp connection (Baileys). Reuses the connection lifecycle of the original demo
 * (QR as image, reconnect with backoff), with the session stored in Google Sheets.
 *
 * Ban-risk rules enforced here:
 *  - only private chats are handled (groups, status, broadcasts, newsletters ignored)
 *  - the bot never starts a conversation; send() is only called in reply to a customer
 *    or after an admin decision on that customer's own payment
 *  - plain text only; incoming messages are marked "seen" after ~1 s and every reply
 *    is preceded by ~2–3 s of "typing…"
 */

const {
  default: makeWASocket,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
} = require('@itsliaaa/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const log = require('./log');
const { useSheetAuthState, clearSession, hasSession, hasUnfinishedPairing } = require('./storage/auth-state');

const baileysLogger = pino({ level: 'silent' });

const runtime = {
  sock: null,
  status: 'stopped', // stopped | starting | qr | connected | reconnecting | replaced
  qrDataUrl: null,
  me: null,
  connectedAt: null,
  lastDisconnect: null,
  reconnectAttempts: 0,
  pairing: null, // { phone, code, at } while a pairing-code login is in progress
  stopping: false,
  starting: false,
};

let messageHandler = async () => {};
function onMessage(fn) {
  messageHandler = fn;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Human-like timing: message is marked "seen" after ~1 s, then "typing…" for ~2–3 s, then the reply.
const READ_MIN_MS = Number(process.env.READ_MIN_MS ?? 800);
const READ_MAX_MS = Number(process.env.READ_MAX_MS ?? 1400);
const TYPING_MIN_MS = Number(process.env.TYPING_MIN_MS ?? 2000);
const TYPING_MAX_MS = Number(process.env.TYPING_MAX_MS ?? 3000);
const readDelay = () => READ_MIN_MS + Math.floor(Math.random() * (READ_MAX_MS - READ_MIN_MS + 1));
const CONNECT_WATCHDOG_MS = 60000;
const typingDelay = () => TYPING_MIN_MS + Math.floor(Math.random() * (TYPING_MAX_MS - TYPING_MIN_MS + 1));

function isConnected() {
  return runtime.status === 'connected' && Boolean(runtime.sock);
}

function getStatus() {
  return {
    status: runtime.status,
    connected: isConnected(),
    qrDataUrl: runtime.status === 'qr' ? runtime.qrDataUrl : null,
    pairing: runtime.status === 'qr' ? runtime.pairing : null,
    me: runtime.me,
    connectedAt: runtime.connectedAt,
    lastDisconnect: runtime.lastDisconnect,
    hasStoredSession: hasSession(),
  };
}

/** Sends a plain text message after showing "typing…" for ~2–3 seconds. */
async function sendText(jid, text) {
  const sock = runtime.sock;
  if (!sock || !isConnected()) throw new Error('WhatsApp ist nicht verbunden');
  try {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate('composing', jid);
    await sleep(typingDelay());
    await sock.sendPresenceUpdate('paused', jid);
  } catch (err) {
    log.warn(`Typing indicator failed for ${jid}: ${err.message}`);
  }
  await sock.sendMessage(jid, { text });
}

async function markRead(msg) {
  try {
    await runtime.sock?.readMessages([msg.key]);
  } catch (err) {
    log.warn(`Could not mark message as read: ${err.message}`);
  }
}

async function downloadImage(msg) {
  return downloadMediaMessage(msg, 'buffer', {}, { logger: baileysLogger, reuploadRequest: runtime.sock.updateMediaMessage });
}

function isPrivateChat(jid) {
  return typeof jid === 'string' && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));
}

function detachSocket() {
  const sock = runtime.sock;
  runtime.sock = null;
  if (!sock) return;
  try { sock.ev.removeAllListeners(); } catch {}
  try { sock.end(undefined); } catch {}
}

function scheduleReconnect(reason) {
  runtime.reconnectAttempts += 1;
  runtime.status = 'reconnecting';
  const delay = Math.min(60000, 2000 * runtime.reconnectAttempts);
  log.warn(`WhatsApp disconnected (${reason}). Reconnecting in ${delay / 1000}s (attempt ${runtime.reconnectAttempts})`);
  setTimeout(() => {
    if (!runtime.stopping) void start();
  }, delay).unref?.();
}

async function start() {
  if (runtime.starting) return { ok: false, message: 'Verbindung wird bereits aufgebaut…' };
  if (isConnected()) return { ok: true, message: 'Bereits verbunden.' };
  runtime.starting = true;
  runtime.stopping = false;
  runtime.status = 'starting';
  try {
    detachSocket();
    if (hasUnfinishedPairing()) {
      log.info('Discarding an unfinished pairing-code login.');
      await clearSession();
    }
    const { state, saveCreds } = useSheetAuthState();
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined; // fall back to the library's built-in version
    }
    log.info(`Starting WhatsApp connection (${hasSession() ? 'stored session' : 'new session, QR needed'})`);
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
      logger: baileysLogger,
      browser: Browsers.macOS('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
    });
    runtime.sock = sock;

    // Baileys can hang silently when the WebSocket never opens (no error, no close event).
    // If we have neither a QR code nor a connection after a minute, tear down and retry.
    setTimeout(() => {
      if (runtime.sock === sock && runtime.status === 'starting') {
        runtime.lastDisconnect = { at: new Date().toISOString(), code: null, message: 'Verbindungsaufbau hängt (Timeout)' };
        detachSocket();
        scheduleReconnect('connect timeout');
      }
    }, CONNECT_WATCHDOG_MS).unref?.();

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (runtime.sock !== sock) return; // event from an old socket
      if (qr) {
        runtime.status = 'qr';
        try {
          runtime.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
          log.info('New QR code available on the dashboard (WhatsApp-Status).');
        } catch (err) {
          log.error(`QR render failed: ${err.message}`);
        }
      }
      if (connection === 'open') {
        runtime.status = 'connected';
        runtime.qrDataUrl = null;
        runtime.pairing = null;
        runtime.reconnectAttempts = 0;
        runtime.connectedAt = new Date().toISOString();
        runtime.me = { id: sock.user?.id || null, name: sock.user?.name || sock.user?.verifiedName || null };
        log.info(`WhatsApp connected as ${runtime.me.name || ''} ${runtime.me.id || ''}`);
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const message = lastDisconnect?.error?.message || 'unknown';
        runtime.lastDisconnect = { at: new Date().toISOString(), code: code ?? null, message };
        runtime.qrDataUrl = null;
        runtime.pairing = null;
        runtime.connectedAt = null;
        detachSocket();
        if (runtime.stopping) {
          runtime.status = 'stopped';
          return;
        }
        if (code === DisconnectReason.loggedOut) {
          log.warn('WhatsApp session logged out (device removed). Clearing stored session — scan a new QR on the dashboard.');
          await clearSession();
          runtime.reconnectAttempts = 0;
          setTimeout(() => void start(), 1000).unref?.();
          return;
        }
        if (code === DisconnectReason.connectionReplaced) {
          // Another instance (e.g. the new Render deploy) took over this session — don't fight it.
          runtime.status = 'replaced';
          log.warn('WhatsApp connection replaced by another instance; not reconnecting.');
          return;
        }
        if (code === DisconnectReason.restartRequired) {
          log.info('WhatsApp requested a restart (normal after QR scan). Reconnecting now.');
          setTimeout(() => void start(), 500).unref?.();
          return;
        }
        scheduleReconnect(`code ${code ?? '?'}: ${message}`);
      }
    });

    sock.ev.on('messages.upsert', ({ type, messages }) => {
      if (type !== 'notify') return;
      for (const msg of messages || []) {
        const jid = msg.key?.remoteJid;
        if (!msg.message || msg.key.fromMe || !isPrivateChat(jid)) continue;
        void (async () => {
          // While the bot is paused, leave messages unread so they stand out on the phone.
          const paused = require('./settings').get('botEnabled') === false;
          if (!paused) {
            await sleep(readDelay());
            await markRead(msg);
          }
          try {
            await messageHandler(msg);
          } catch (err) {
            log.error(`Handling message from ${jid} failed: ${err.stack || err.message}`);
          }
        })();
      }
    });

    return { ok: true, message: 'Verbindung wird aufgebaut.' };
  } catch (err) {
    log.error(`WhatsApp start failed: ${err.message}`);
    scheduleReconnect(err.message);
    return { ok: false, message: err.message };
  } finally {
    runtime.starting = false;
  }
}

const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Login with a pairing code instead of the QR code: WhatsApp on the phone →
 * Verknüpfte Geräte → Gerät hinzufügen → "Stattdessen mit Telefonnummer verknüpfen".
 * `phone` must include the country code (e.g. 49 170 1234567).
 */
async function requestPairingCode(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) throw new Error('Bitte die Nummer mit Ländervorwahl eingeben, z. B. 49 170 1234567.');
  if (digits.length < 8 || digits.length > 15) throw new Error('Ungültige Telefonnummer.');
  if (isConnected()) throw new Error('WhatsApp ist bereits verbunden.');
  if (runtime.stopping || (!runtime.sock && !runtime.starting)) await start();
  // The socket accepts a pairing request once WhatsApp offers a login (= the QR stage).
  for (let i = 0; i < 40 && runtime.status !== 'qr'; i++) await sleep2(500);
  if (runtime.status !== 'qr' || !runtime.sock) throw new Error('Verbindung zu WhatsApp noch nicht bereit – bitte in ein paar Sekunden erneut versuchen.');
  const raw = await runtime.sock.requestPairingCode(digits);
  const code = String(raw).replace(/(.{4})(?=.)/, '$1-');
  runtime.pairing = { phone: '+' + digits, code, at: new Date().toISOString() };
  log.info(`Pairing code requested for +${digits}.`);
  return runtime.pairing;
}

async function stop() {
  runtime.stopping = true;
  detachSocket();
  runtime.status = 'stopped';
  runtime.qrDataUrl = null;
  runtime.connectedAt = null;
}

/** Logs out (unlinks the device) and starts again with a fresh QR code. */
async function logoutAndRelink() {
  try {
    await runtime.sock?.logout();
  } catch (err) {
    log.warn(`Logout failed: ${err.message}`);
  }
  await stop();
  await clearSession();
  runtime.stopping = false;
  return start();
}

module.exports = { start, stop, logoutAndRelink, requestPairingCode, getStatus, isConnected, onMessage, sendText, downloadImage };
