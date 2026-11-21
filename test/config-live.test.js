'use strict';
/**
 * The other tests run against test/fixtures/, so this one checks the REAL config files in
 * config/ — the ones that are actually deployed. It is what catches a typo in a group link
 * or a package that no menu can reach.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

/** Loads src/config in a separate process, against the real config/ files. */
function loadRealConfig(mode) {
  const root = path.join(__dirname, '..');
  const out = execFileSync(process.execPath, ['-e', `
    const c = require(${JSON.stringify(path.join(root, 'src', 'config.js'))});
    process.stdout.write(JSON.stringify({
      mode: c.MODE, currency: c.CURRENCY, recipient: c.BANK.recipient, account: c.BANK.account,
      coachings: c.coachings.map((x) => ({ id: x.id, name: x.name, price: x.price, link: x.groupLink, keywords: x.keywords })),
      detectable: c.detectableCoachings.map((x) => x.id),
      menus: c.menus.map((m) => ({ id: m.id, triggers: m.triggers, keywords: m.keywords, options: m.options.map((o) => o.id), texts: m.texts })),
    }));
  `], { env: { ...process.env, PAYMENT_MODE: mode, COACHINGS_FILE: '', MENUS_FILE: '' }, encoding: 'utf8' });
  return JSON.parse(out);
}

test('the deployed config loads in every payment mode', () => {
  for (const mode of ['trial', 'live', 'test']) {
    const c = loadRealConfig(mode);
    assert.strictEqual(c.mode, mode);
    assert.ok(c.coachings.length > 0, `${mode}: no coachings`);
    for (const x of c.coachings) {
      assert.ok(typeof x.price === 'number' && x.price > 0, `${mode}: ${x.id} has no usable price`);
    }
  }
});

test('every coaching is reachable: by keyword, or through a menu', () => {
  const c = loadRealConfig('trial');
  const inMenu = new Set(c.menus.flatMap((m) => m.options));
  for (const x of c.coachings) {
    const reachable = inMenu.has(x.id) || x.keywords.length > 0;
    assert.ok(reachable, `${x.id} has no keywords and is in no menu — no customer can ever reach it`);
  }
});

test('every coaching has a usable group invite link', () => {
  const c = loadRealConfig('trial');
  for (const x of c.coachings) {
    assert.ok(/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]/.test(x.link), `${x.id} has no valid group link: ${x.link}`);
  }
});

test('menu triggers are unique, and menu texts are complete', () => {
  const c = loadRealConfig('trial');
  const seen = new Set();
  for (const m of c.menus) {
    assert.ok(m.options.length > 0, `${m.id} has no packages`);
    for (const word of [...m.triggers, ...m.keywords]) {
      assert.ok(!seen.has(word), `"${word}" opens more than one menu`);
      seen.add(word);
    }
    for (const lang of ['de', 'en']) {
      for (const key of ['intro', 'requestReceipt', 'verified']) {
        assert.ok(m.texts[lang]?.[key], `${m.id}: texts.${lang}.${key} is missing`);
      }
    }
  }
});

test('trial and test modes never charge the real prices', () => {
  const live = loadRealConfig('live');
  for (const mode of ['trial', 'test']) {
    const c = loadRealConfig(mode);
    for (const x of c.coachings) {
      const real = live.coachings.find((l) => l.id === x.id).price;
      assert.ok(x.price < real || real <= 5,
        `${mode}: ${x.id} would charge ${x.price} €, the real price is ${real} € — add it to "prices" in config/payment.json`);
    }
  }
});

test('live mode uses the client account, test mode does not', () => {
  assert.strictEqual(loadRealConfig('live').recipient, 'Ilyas Lang');
  assert.strictEqual(loadRealConfig('trial').recipient, 'Ilyas Lang'); // trial = real account, tiny prices
  assert.notStrictEqual(loadRealConfig('test').recipient, 'Ilyas Lang');
});
