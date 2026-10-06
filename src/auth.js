'use strict';
/**
 * Dashboard login.
 *
 * The first password comes from env DASHBOARD_PASSWORD. It can be changed in the dashboard
 * (Einstellungen → Passwort); the new one is stored only as a salted scrypt hash in the
 * sheet (settings tab, key "dashboardPassword") and from then on replaces the env password.
 * Forgot it? Delete the "dashboardPassword" row in the settings tab and restart → env password works again.
 *
 * Sessions are signed, HttpOnly cookies (7 days) — no session storage needed. Changing the
 * password logs out every other browser. Repeated wrong passwords lock the IP for 15 minutes.
 */

const crypto = require('crypto');
const settings = require('./settings');

const COOKIE = 'dash_session';
const MAX_AGE_S = 7 * 24 * 3600;
const MIN_LENGTH = 8;

// ---------- password storage ----------

function storedHash() {
  const v = settings.get('dashboardPassword');
  return v && v.salt && v.hash ? v : null;
}

function scrypt(password, salt) {
  return crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), 32).toString('base64');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isConfigured() {
  return Boolean(storedHash() || process.env.DASHBOARD_PASSWORD);
}

function checkPassword(password) {
  const h = storedHash();
  if (h) return safeEqual(scrypt(password, h.salt), h.hash);
  const env = process.env.DASHBOARD_PASSWORD || '';
  return Boolean(env) && safeEqual(String(password || ''), env);
}

/** Changing the password changes the signing key, so all existing sessions end. */
function signingKey() {
  const h = storedHash();
  return 'dashboard:' + (h ? h.hash : process.env.DASHBOARD_PASSWORD || '');
}

function sign(value) {
  return crypto.createHmac('sha256', signingKey()).update(value).digest('base64url');
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isLoggedIn(req) {
  if (!isConfigured()) return false;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return false;
  const [expires, sig] = token.split('.');
  if (!expires || !sig || Number(expires) < Date.now() / 1000) return false;
  return safeEqual(sig, sign(expires));
}

function setSessionCookie(req, res) {
  const expires = String(Math.floor(Date.now() / 1000) + MAX_AGE_S);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${expires}.${sign(expires)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure ? '; Secure' : ''}`
  );
}

// ---------- brute-force protection ----------

const attempts = new Map(); // ip -> { fails, lockedUntil }
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function lockedFor(req) {
  const a = attempts.get(clientIp(req));
  return a?.lockedUntil && a.lockedUntil > Date.now() ? Math.ceil((a.lockedUntil - Date.now()) / 60000) : 0;
}

function recordFail(req) {
  const ip = clientIp(req);
  const a = attempts.get(ip) || { fails: 0, lockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) {
    a.lockedUntil = Date.now() + LOCK_MS;
    a.fails = 0;
  }
  attempts.set(ip, a);
}

/** Returns 'ok' | 'wrong' | 'locked'. */
async function login(req, res) {
  if (lockedFor(req)) return 'locked';
  if (!checkPassword(req.body?.password || '')) {
    recordFail(req);
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return lockedFor(req) ? 'locked' : 'wrong';
  }
  attempts.delete(clientIp(req));
  setSessionCookie(req, res);
  return 'ok';
}

function logout(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Change the dashboard password (requires the current one). Keeps this browser logged in. */
function changePassword(req, res) {
  const { current, next, confirm } = req.body || {};
  if (!checkPassword(current || '')) throw new Error('Das aktuelle Passwort ist falsch.');
  if (String(next || '').length < MIN_LENGTH) throw new Error(`Das neue Passwort muss mindestens ${MIN_LENGTH} Zeichen haben.`);
  if (next !== confirm) throw new Error('Die beiden neuen Passwörter stimmen nicht überein.');
  const salt = crypto.randomBytes(16).toString('base64');
  settings.set('dashboardPassword', { salt, hash: scrypt(next, salt), changedAt: new Date().toISOString() });
  setSessionCookie(req, res);
  return { ok: true };
}

function passwordInfo() {
  const h = storedHash();
  return { source: h ? 'dashboard' : 'env', changedAt: h?.changedAt || null, envSet: Boolean(process.env.DASHBOARD_PASSWORD) };
}

/** Express middleware: API calls get 401, page requests are redirected to /login. */
function requireLogin(req, res, next) {
  if (isLoggedIn(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'Nicht angemeldet' });
  return res.redirect('/login');
}

module.exports = { isLoggedIn, login, logout, requireLogin, changePassword, passwordInfo, isConfigured, lockedFor };
