// Shared top navigation for all dashboard pages.
(function () {
  const links = [
    ['/', 'Übersicht'],
    ['/pruefungen', 'Offene Prüfungen'],
    ['/whatsapp', 'WhatsApp-Status'],
  ];
  const here = location.pathname;
  const active = (href) => (href === '/' ? here === '/' || here.startsWith('/kategorie') : here.startsWith(href));
  document.getElementById('nav').outerHTML =
    '<header class="top"><span class="brand">Coaching-Dashboard</span><nav>' +
    links.map(([href, label]) => `<a href="${href}" class="${active(href) ? 'active' : ''}">${label}</a>`).join('') +
    '</nav><form method="post" action="/logout"><button type="submit">Abmelden</button></form></header>';
})();
