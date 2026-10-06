'use strict';
const test = require('node:test');
const assert = require('node:assert');

async function fresh() {
  for (const k of Object.keys(require.cache)) if (k.includes('/src/')) delete require.cache[k];
  process.env.DASHBOARD_PASSWORD = 'start-pass';
  const db = require('../src/storage/db');
  await db.init(require('../src/storage/backend-memory').createMemoryBackend());
  return { auth: require('../src/auth'), settings: require('../src/settings') };
}
const res = () => { const r = { headers: {} }; r.setHeader = (k, v) => (r.headers[k] = v); return r; };
const req = (body, cookie, ip = '1.2.3.4') => ({ body, ip, headers: { cookie: cookie || '' }, secure: true });
const cookieOf = (r) => r.headers['Set-Cookie'].split(';')[0];

test('login with env password, change password, old password and old sessions stop working', async () => {
  const { auth, settings } = await fresh();
  const r1 = res();
  assert.strictEqual(await auth.login(req({ password: 'start-pass' }), r1), 'ok');
  const oldCookie = cookieOf(r1);
  assert.ok(auth.isLoggedIn(req({}, oldCookie)));

  assert.throws(() => auth.changePassword(req({ current: 'wrong', next: 'neues-pass-1', confirm: 'neues-pass-1' }), res()), /aktuelle Passwort ist falsch/);
  assert.throws(() => auth.changePassword(req({ current: 'start-pass', next: 'kurz', confirm: 'kurz' }), res()), /mindestens 8/);
  assert.throws(() => auth.changePassword(req({ current: 'start-pass', next: 'neues-pass-1', confirm: 'anders-123' }), res()), /stimmen nicht/);
  const r2 = res();
  auth.changePassword(req({ current: 'start-pass', next: 'neues-pass-1', confirm: 'neues-pass-1' }), r2);
  assert.ok(auth.isLoggedIn(req({}, cookieOf(r2))), 'current browser stays logged in');
  assert.ok(!auth.isLoggedIn(req({}, oldCookie)), 'other sessions are logged out');
  assert.strictEqual(await auth.login(req({ password: 'start-pass' }, '', '5.5.5.5'), res()), 'wrong');
  assert.strictEqual(await auth.login(req({ password: 'neues-pass-1' }, '', '5.5.5.6'), res()), 'ok');

  const stored = settings.get('dashboardPassword');
  assert.ok(stored.hash && stored.salt && !JSON.stringify(stored).includes('neues-pass-1'), 'only a hash is stored');
  assert.ok(!('dashboardPassword' in settings.all()), 'hash is never exposed via the settings API');
});

test('too many wrong passwords lock the IP', async () => {
  const { auth } = await fresh();
  let last;
  for (let i = 0; i < 8; i++) last = await auth.login(req({ password: 'nope' }, '', '9.9.9.9'), res());
  assert.strictEqual(last, 'locked');
  assert.strictEqual(await auth.login(req({ password: 'start-pass' }, '', '9.9.9.9'), res()), 'locked', 'even the right password is blocked while locked');
  assert.strictEqual(await auth.login(req({ password: 'start-pass' }, '', '8.8.8.8'), res()), 'ok', 'other IPs are not affected');
});
