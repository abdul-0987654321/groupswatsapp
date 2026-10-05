'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startFakeWebApp } = require('./helpers/fake-apps-script');
const { createSheetsBackend } = require('../src/storage/backend-sheets');

// db.js is a singleton; load a fresh copy per test.
function freshDb() {
  for (const k of Object.keys(require.cache)) if (k.includes('/src/storage/')) delete require.cache[k];
  return { db: require('../src/storage/db'), auth: require('../src/storage/auth-state') };
}

test('Apps Script rejects a wrong secret', async () => {
  const app = await startFakeWebApp();
  try {
    const backend = createSheetsBackend({ url: app.url, secret: 'wrong' });
    await assert.rejects(backend.load(['customers']), /unauthorized/);
  } finally {
    await app.close();
  }
});

test('records survive a "restart": write via Apps Script, reload into a fresh process state', async () => {
  const app = await startFakeWebApp();
  try {
    let { db } = freshDb();
    await db.init(createSheetsBackend({ url: app.url, secret: app.secret }));
    db.put('customers', { jid: '491701234567@s.whatsapp.net', phone: '+491701234567', name: 'Anna', stage: 'awaiting_screenshot', coachingId: 'C1' });
    db.put('payments', { id: 'Z-0001', jid: '491701234567@s.whatsapp.net', amount: 75, status: 'NEEDS_REVIEW', reasons: ['Falscher Betrag', 'Zu alt'] });
    db.put('chat', { id: 'm1', jid: 'x', direction: 'in', text: '{"looks":"like json"} but is text' });
    const huge = 'x'.repeat(120000); // > 2 cells worth
    db.put('session', { key: 'app-state-sync-version-regular', value: huge });
    db.put('session', { key: 'pre-key-1', value: '{"a":1}' });
    db.put('session', { key: 'pre-key-2', value: '{"a":2}' });
    await db.flush();
    db.remove('session', 'pre-key-1');
    db.put('customers', { jid: '491701234567@s.whatsapp.net', phone: '+491701234567', name: 'Anna B', stage: 'verified', coachingId: 'C1' });
    await db.flush();

    // Phone number must stay text (no number conversion) in the sheet
    const custSheet = app.ss.getSheetByName('customers');
    assert.strictEqual(custSheet.rows.length, 2, 'upsert must update, not append');

    ({ db } = freshDb());
    await db.init(createSheetsBackend({ url: app.url, secret: app.secret }));
    assert.deepStrictEqual(db.get('customers', '491701234567@s.whatsapp.net'), {
      jid: '491701234567@s.whatsapp.net', phone: '+491701234567', name: 'Anna B', stage: 'verified', coachingId: 'C1',
    });
    assert.deepStrictEqual(db.get('payments', 'Z-0001').reasons, ['Falscher Betrag', 'Zu alt']);
    assert.strictEqual(db.get('chat', 'm1').text, '{"looks":"like json"} but is text');
    assert.strictEqual(db.get('session', 'app-state-sync-version-regular').value, huge);
    assert.strictEqual(db.get('session', 'pre-key-1'), null);
    assert.strictEqual(db.get('session', 'pre-key-2').value, '{"a":2}');

    // A chunked value that shrinks must not keep stale chunks
    db.put('session', { key: 'app-state-sync-version-regular', value: 'short' });
    await db.flush();
    ({ db } = freshDb());
    await db.init(createSheetsBackend({ url: app.url, secret: app.secret }));
    assert.strictEqual(db.get('session', 'app-state-sync-version-regular').value, 'short');
  } finally {
    await app.close();
  }
});

test('Baileys auth state round-trips Buffers through the sheet', async () => {
  const app = await startFakeWebApp();
  try {
    let { db, auth } = freshDb();
    await db.init(createSheetsBackend({ url: app.url, secret: app.secret }));
    const a = auth.useSheetAuthState();
    a.state.creds.me = { id: '4917600000000:1@s.whatsapp.net' };
    await a.saveCreds();
    await a.state.keys.set({ 'pre-key': { 5: { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5]) } } });
    await db.flush();

    ({ db, auth } = freshDb());
    await db.init(createSheetsBackend({ url: app.url, secret: app.secret }));
    assert.ok(auth.hasSession());
    const b = auth.useSheetAuthState();
    assert.deepStrictEqual(b.state.creds.noiseKey.private, a.state.creds.noiseKey.private);
    assert.ok(Buffer.isBuffer(b.state.creds.noiseKey.private));
    const keys = await b.state.keys.get('pre-key', ['5', '6']);
    assert.deepStrictEqual(keys['5'].public, Buffer.from([1, 2, 3]));
    assert.strictEqual(keys['6'], null);

    await auth.clearSession();
    ({ db, auth } = freshDb());
    await db.init(createSheetsBackend({ url: app.url, secret: app.secret }));
    assert.ok(!auth.hasSession());
  } finally {
    await app.close();
  }
});

test('screenshots go to Drive and come back unchanged', async () => {
  const app = await startFakeWebApp();
  try {
    const backend = createSheetsBackend({ url: app.url, secret: app.secret });
    const img = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10, 0x20]);
    const id = await backend.putFile('beleg.jpg', 'image/jpeg', img);
    const back = await backend.getFile(id);
    assert.deepStrictEqual(back.buffer, img);
    assert.strictEqual(back.mimeType, 'image/jpeg');
  } finally {
    await app.close();
  }
});
