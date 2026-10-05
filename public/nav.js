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
    ['/whatsapp', 'WhatsApp-Status'],
    ['/beleg-testen', 'Beleg testen'],
  ];
  const here = location.pathname;
  const active = (href) => (href === '/' ? here === '/' || here.startsWith('/kategorie') : here.startsWith(href));
  document.getElementById('nav').outerHTML =
    '<header class="top"><span class="brand">Coaching-Dashboard</span><nav>' +
    links.map(([href, label]) => `<a href="${href}" class="${active(href) ? 'active' : ''}">${label}</a>`).join('') +
    '</nav><div class="right">' + langSwitch() + '<form method="post" action="/logout"><button type="submit">Abmelden</button></form></div></header>';
  // Badge with the number of open reviews
  fetch('/api/reviews').then((r) => (r.ok ? r.json() : null)).then((d) => {
    const n = d?.rows?.length || 0;
    const a = document.querySelector('header.top a[href="/pruefungen"]');
    if (n && a) a.insertAdjacentHTML('beforeend', ` <span class="badge">${n}</span>`);
  }).catch(() => {});
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
