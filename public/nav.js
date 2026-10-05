// Shared top navigation for all dashboard pages.
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
    '</nav><form method="post" action="/logout"><button type="submit">Abmelden</button></form></header>';
  // Badge with the number of open reviews
  fetch('/api/reviews').then((r) => (r.ok ? r.json() : null)).then((d) => {
    const n = d?.rows?.length || 0;
    const a = document.querySelector('header.top a[href="/pruefungen"]');
    if (n && a) a.insertAdjacentHTML('beforeend', ` <span class="badge">${n}</span>`);
  }).catch(() => {});
  // Red/green dot showing whether WhatsApp is connected
  fetch('/api/whatsapp').then((r) => (r.ok ? r.json() : null)).then((d) => {
    const a = document.querySelector('header.top a[href="/whatsapp"]');
    if (d && a) a.insertAdjacentHTML('afterbegin', `<span class="dot ${d.connected ? 'green' : 'red'}" title="${d.connected ? 'verbunden' : 'nicht verbunden'}" style="margin-right:6px"></span>`);
  }).catch(() => {});
})();
