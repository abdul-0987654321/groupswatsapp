// App layout for every dashboard page: menu on the left (☰ on phones), status bar on top.
// Needs app.js (esc, ui) to be loaded first.
(function () {
  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    home: icon('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
    review: icon('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
    chat: icon('<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>'),
    phone: icon('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'),
    test: icon('<path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/>'),
    gear: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    logo: icon('<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15l4-4 3 3 5-6"/>'),
  };
  const links = [
    ['/', 'Übersicht', 'home'],
    ['/pruefungen', 'Offene Prüfungen', 'review'],
    ['/chats', 'Chats', 'chat'],
    ['/whatsapp', 'WhatsApp verbinden', 'phone'],
    ['/beleg-testen', 'Beleg testen', 'test'],
    ['/einstellungen', 'Einstellungen', 'gear'],
  ];
  const here = location.pathname;
  const isActive = (href) => (href === '/' ? here === '/' || here.startsWith('/kategorie') : here.startsWith(href));
  const cur = window.dashboardLang || 'de';

  document.body.classList.add('layout');
  const main = document.querySelector('main');
  const content = document.createElement('div');
  content.className = 'content';
  main.parentNode.insertBefore(content, main);

  document.getElementById('nav').outerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="brand"><span class="logo">${ICONS.logo}</span>Coaching-Dashboard</div>
      <nav>${links.map(([href, label, ic]) => `<a href="${href}" class="${isActive(href) ? 'active' : ''}" data-href="${href}">${ICONS[ic]}<span>${label}</span></a>`).join('')}</nav>
      <div class="bottom">
        <span class="lang-switch" role="group" aria-label="Sprache">${['de', 'en'].map((l) => `<button type="button" class="${cur === l ? 'on' : ''}" onclick="setDashboardLang('${l}')">${l === 'de' ? 'Deutsch' : 'English'}</button>`).join('')}</span>
        <form method="post" action="/logout"><button type="submit">Abmelden</button></form>
      </div>
    </aside>`;

  const pageTitle = document.title.split(' – ')[0];
  content.innerHTML = `
    <header class="topbar">
      <button type="button" class="menu-btn ghost" id="menuBtn" aria-label="Menü">☰</button>
      <span class="title">${esc(pageTitle)}</span>
      <a class="chip" id="waChip" href="/whatsapp" title="WhatsApp-Verbindung"><span class="dot grey"></span><span>WhatsApp …</span></a>
      <button type="button" class="chip" id="botChip" hidden></button>
    </header>
    <div id="strips"></div>`;
  content.appendChild(main);

  document.getElementById('menuBtn').addEventListener('click', () => document.body.classList.toggle('menu-open'));
  document.addEventListener('click', (e) => {
    if (document.body.classList.contains('menu-open') && !e.target.closest('#sidebar') && !e.target.closest('#menuBtn')) document.body.classList.remove('menu-open');
  });

  let botEnabled = true;
  async function setBot(enable) {
    const ok = await ui.confirm(
      enable ? 'Der Bot antwortet ab jetzt wieder automatisch auf neue Nachrichten.' : 'Der Bot antwortet dann niemandem mehr, bis du ihn wieder einschaltest. WhatsApp bleibt verbunden, Nachrichten werden weiter gespeichert.',
      { title: enable ? 'Bot einschalten?' : 'Bot pausieren?', ok: enable ? 'Ja, einschalten' : 'Ja, pausieren', icon: enable ? '▶️' : '⏸️' }
    );
    if (!ok) return;
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ botEnabled: enable }) });
      ui.toast(enable ? 'Bot ist wieder an.' : 'Bot ist pausiert.', enable ? 'ok' : 'warn');
      refresh();
    } catch (e) { ui.toast(e.message, 'err'); }
  }
  document.getElementById('botChip').addEventListener('click', () => setBot(!botEnabled));

  async function refresh() {
    let s;
    try { s = await api('/api/summary'); } catch (_) { return; }
    // WhatsApp chip
    const wa = document.getElementById('waChip');
    const connected = s.whatsapp.connected;
    const waiting = ['starting', 'reconnecting'].includes(s.whatsapp.status);
    wa.className = 'chip ' + (connected ? 'green' : waiting ? 'yellow' : 'red');
    wa.innerHTML = `<span class="dot ${connected ? 'green' : waiting ? 'yellow' : 'red'}"></span><span>${connected ? 'WhatsApp verbunden' : waiting ? 'WhatsApp verbindet…' : 'WhatsApp nicht verbunden – hier verbinden'}</span>`;
    // Bot chip
    botEnabled = s.botEnabled;
    const bot = document.getElementById('botChip');
    bot.hidden = false;
    bot.className = 'chip ' + (botEnabled ? 'green' : 'yellow');
    bot.innerHTML = botEnabled ? '<span class="dot green"></span><span>Bot an</span>' : '<span class="dot yellow"></span><span>Bot pausiert</span>';
    bot.title = botEnabled ? 'Klicken, um den Bot zu pausieren' : 'Klicken, um den Bot wieder einzuschalten';
    // Open reviews count in the menu
    const a = document.querySelector('.sidebar a[data-href="/pruefungen"]');
    a.querySelector('.count')?.remove();
    if (s.openReviews) a.insertAdjacentHTML('beforeend', `<span class="count">${s.openReviews}</span>`);
    // Strips: test mode, paused, storage problems
    const strips = [];
    if (s.mode === 'test') {
      strips.push(`<div class="strip test">TESTMODUS – Kunden sehen das Testkonto (${esc(s.account.recipient)}, ${esc(s.account.account)}${s.account.bankName ? ', ' + esc(s.account.bankName) : ''}) und Testpreise in ${esc(s.currency)}.</div>`);
    }
    if (!botEnabled) strips.push('<div class="strip paused">⏸ Bot pausiert – er antwortet niemandem. Nachrichten werden gespeichert (siehe Chats). <button type="button" class="primary" id="resumeBtn">Bot einschalten</button></div>');
    if (s.storageError) strips.push(`<div class="strip test">Google Sheet: ${esc(s.storageError)}</div>`);
    const box = document.getElementById('strips');
    const html = strips.join('');
    if (box.dataset.html !== html) {
      box.innerHTML = html;
      box.dataset.html = html;
      document.getElementById('resumeBtn')?.addEventListener('click', () => setBot(true));
    }
    window.dispatchEvent(new CustomEvent('summary', { detail: s }));
  }
  refresh();
  setInterval(refresh, 15000);
  window.refreshSummary = refresh;
})();
