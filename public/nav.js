// Shared top navigation for all dashboard pages.
const escNav = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function langSwitch() {
  const cur = window.dashboardLang || 'de';
  return '<span class="lang-switch" role="group" aria-label="Sprache">' +
    ['de', 'en'].map((l) => `<button type="button" class="${cur === l ? 'on' : ''}" onclick="setDashboardLang('${l}')">${l.toUpperCase()}</button>`).join('') +
    '</span>';
}
(function () {
  const links = [
    ['/', 'Übersicht'],
    ['/pruefungen', 'Offene Prüfungen'],
    ['/chats', 'Chats'],
    ['/whatsapp', 'WhatsApp-Status'],
    ['/beleg-testen', 'Beleg testen'],
  ];
  const here = location.pathname;
  const active = (href) => (href === '/' ? here === '/' || here.startsWith('/kategorie') : here.startsWith(href));
  document.getElementById('nav').outerHTML =
    '<header class="top"><span class="brand">Coaching-Dashboard</span><nav>' +
    links.map(([href, label]) => `<a href="${href}" class="${active(href) ? 'active' : ''}">${label}</a>`).join('') +
    '</nav><div class="right"><button type="button" id="botToggle" class="bot-toggle" hidden></button>' + langSwitch() + '<form method="post" action="/logout"><button type="submit">Abmelden</button></form></div></header>';
  // Badge with the number of open reviews
  fetch('/api/reviews').then((r) => (r.ok ? r.json() : null)).then((d) => {
    const n = d?.rows?.length || 0;
    const a = document.querySelector('header.top a[href="/pruefungen"]');
    if (n && a) a.insertAdjacentHTML('beforeend', ` <span class="badge">${n}</span>`);
  }).catch(() => {});
  // Bot on/off switch (pausing keeps WhatsApp connected but stops all automatic replies)
  const toggle = document.getElementById('botToggle');
  function drawToggle(enabled) {
    toggle.hidden = false;
    toggle.className = 'bot-toggle ' + (enabled ? 'on' : 'off');
    toggle.textContent = enabled ? '● Bot an' : '■ Bot pausiert';
    toggle.title = enabled ? 'Klicken, um den Bot zu pausieren' : 'Klicken, um den Bot wieder einzuschalten';
    toggle.dataset.enabled = enabled ? '1' : '0';
    document.getElementById('pausedBanner')?.remove();
    if (!enabled) {
      document.querySelector('header.top').insertAdjacentHTML('afterend',
        '<div id="pausedBanner" class="paused">Bot pausiert – der Bot antwortet niemandem. Nachrichten werden gespeichert (siehe Chats) und bleiben auf dem Handy ungelesen.</div>');
    }
  }
  fetch('/api/settings').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) drawToggle(d.settings?.botEnabled !== false); }).catch(() => {});
  toggle.addEventListener('click', async () => {
    const enable = toggle.dataset.enabled !== '1';
    const q = enable
      ? 'Bot wieder einschalten? Er antwortet ab jetzt wieder automatisch auf neue Nachrichten.'
      : 'Bot pausieren? Er antwortet dann niemandem mehr, bis du ihn wieder einschaltest. WhatsApp bleibt verbunden.';
    if (!confirm(q)) return;
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botEnabled: enable }) });
    const d = await res.json();
    if (d.ok) drawToggle(d.settings.botEnabled !== false); else alert(d.error);
  });
  // Big red banner while the bot runs in TEST mode (test account + test prices)
  fetch('/api/settings').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d?.mode !== 'test') return;
    const a = d.account || {};
    document.querySelector('header.top').insertAdjacentHTML('afterend',
      `<div class="testmode">TESTMODUS – Kunden sehen das Testkonto (${escNav(a.recipient)}, ${escNav(a.account)}${a.bankName ? ', ' + escNav(a.bankName) : ''}) und Testpreise in ${escNav(d.currency)}. Vor dem Livegang in config/payment.json "mode": "live" setzen.</div>`);
  }).catch(() => {});
  // Red/green dot showing whether WhatsApp is connected
  fetch('/api/whatsapp').then((r) => (r.ok ? r.json() : null)).then((d) => {
    const a = document.querySelector('header.top a[href="/whatsapp"]');
    if (d && a) a.insertAdjacentHTML('afterbegin', `<span class="dot ${d.connected ? 'green' : 'red'}" title="${d.connected ? 'verbunden' : 'nicht verbunden'}" style="margin-right:6px"></span>`);
  }).catch(() => {});
})();
