// Shared helpers for the dashboard pages.
const STATUS_TEXT = { VERIFIED: ['green', 'bestätigt'], NEEDS_REVIEW: ['yellow', 'in Prüfung'], REJECTED: ['red', 'abgelehnt'], SUPERSEDED: ['grey', 'ersetzt'] };
const STAGE_TEXT = { new: 'neu', ask_coaching: 'wählt Coaching', confirm_coaching: 'bestätigt Coaching', awaiting_screenshot: 'wartet auf Beleg', in_review: 'in Prüfung', verified: 'freigeschaltet' };

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (res.status === 401) { location.href = '/login'; throw new Error('Nicht angemeldet'); }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Fehler');
  if (json.currency) CURRENCY = json.currency;
  return json;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let CURRENCY = 'EUR'; // set from every API response (EUR live, e.g. PKR in test mode)
const euro = (n, cur) => (n == null || n === '' ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: cur || CURRENCY }));
const dateDE = (ymd) => (ymd ? ymd.split('-').reverse().join('.') : '–');
const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
// ---------- in-page dialogs & notices (no browser popups) ----------
const ui = {
  /** Confirmation dialog. Resolves true/false. */
  confirm(message, { title = 'Bist du sicher?', ok = 'Ja, fortfahren', cancel = 'Abbrechen', danger = false, icon = danger ? '⚠️' : '❓' } = {}) {
    return new Promise((resolve) => {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = `<div class="modal small" role="dialog" aria-modal="true">
        <div class="icon">${icon}</div><h2>${esc(title)}</h2><p>${esc(message)}</p>
        <div class="actions"><button data-v="0">${esc(cancel)}</button><button data-v="1" class="${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div></div>`;
      const done = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      bg.addEventListener('click', (e) => { if (e.target === bg) done(false); const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(bg);
      bg.querySelector('[data-v="1"]').focus();
    });
  },
  /** Small notice in the bottom-right corner. type: ok | err | warn | info */
  toast(message, type = 'ok', ms = 4500) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.remove(), ms);
  },
};

function statusPill(status) {
  const [color, label] = STATUS_TEXT[status] || ['grey', status];
  return `<span class="pill ${color}"><span class="dot ${color}"></span>${esc(label)}</span>`;
}

/** WhatsApp-style chat bubbles; images/PDFs are shown inline (click opens full size). */
function renderChat(messages) {
  if (!messages.length) return '<span class="muted">Kein Verlauf.</span>';
  let lastDay = '';
  return messages.map((m) => {
    const day = new Date(m.at).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    const sep = day !== lastDay ? `<div class="day">${esc(day)}</div>` : '';
    lastDay = day;
    const url = `/api/chat-media/${encodeURIComponent(m.id)}`;
    let media = '';
    if (m.hasFile) {
      media = m.mimeType === 'application/pdf'
        ? `<a class="file" href="${url}" target="_blank">📄 PDF öffnen</a>`
        : `<a href="${url}" target="_blank"><img class="chat-img" src="${url}" alt="Bild" loading="lazy"></a>`;
    }
    const caption = m.hasFile ? m.text.replace(/^\[(Bild|PDF)\]\s*/, '') : m.text;
    const pay = m.paymentId ? `<a href="#" class="paylink" data-open="${esc(m.paymentId)}">Beleg ${esc(m.paymentId)} öffnen</a>` : '';
    const time = new Date(m.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `${sep}<div class="msg ${m.direction === 'out' ? 'out' : 'in'}">${media}${caption ? `<div>${esc(caption)}</div>` : ''}${pay}<span class="time">${time}</span></div>`;
  }).join('');
}

/** Payment table with live search. rows: from the API; opts.showCoaching adds a column. */
function renderPaymentTable(container, rows, { showCoaching = false, onChange } = {}) {
  container.innerHTML = `
    <div class="toolbar"><input type="search" placeholder="Suche nach Name, ID oder Telefon…" aria-label="Suche"><span class="muted count"></span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Name</th><th>Telefon</th>${showCoaching ? '<th>Coaching</th>' : ''}<th>Betrag</th><th>Zahlungsdatum</th><th>Status</th></tr></thead>
      <tbody></tbody></table></div>`;
  const tbody = container.querySelector('tbody');
  const input = container.querySelector('input');
  const count = container.querySelector('.count');
  function draw() {
    const q = input.value.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const shown = rows.filter((r) => !q ||
      [r.id, r.customerId, r.name, r.whatsappName].some((v) => String(v || '').toLowerCase().includes(q)) ||
      (digits.length >= 3 && String(r.phone || '').replace(/\D/g, '').includes(digits)));
    count.textContent = `${shown.length} von ${rows.length}`;
    tbody.innerHTML = shown.length ? shown.map((r) => `
      <tr class="clickable" data-id="${esc(r.id)}">
        <td>${esc(r.customerId)}<div class="muted" style="font-size:12px">${esc(r.id)}</div></td>
        <td>${esc(r.name)}</td><td>${esc(r.phone)}</td>
        ${showCoaching ? `<td>${esc(r.coachingName)}</td>` : ''}
        <td>${euro(r.amount, r.currency)}${r.amount != null && r.amount !== r.expectedAmount ? ` <span class="muted">(soll ${euro(r.expectedAmount, r.currency)})</span>` : ''}</td>
        <td>${dateDE(r.paymentDate)}</td>
        <td>${statusPill(r.status)}${r.status === 'NEEDS_REVIEW' && r.reasons.length ? `<div class="muted" style="font-size:12px;white-space:normal;max-width:280px">${esc(r.reasons.join(' · '))}</div>` : ''}</td>
      </tr>`).join('') : `<tr><td colspan="7"><div class="empty-state"><div class="big">📭</div>Keine Einträge.</div></td></tr>`;
  }
  input.addEventListener('input', draw);
  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openPayment(tr.dataset.id, onChange);
  });
  draw();
}

/** Detail view: screenshot, extracted data, checks, chat history, actions. */
async function openPayment(id, onChange) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = '<div class="modal"><button class="close" aria-label="Schließen">×</button><p>Lade…</p></div>';
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.classList.contains('close')) close(); });
  document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });

  let d;
  try { d = await api('/api/payments/' + encodeURIComponent(id)); } catch (err) { bg.querySelector('.modal').innerHTML += `<p class="banner err">${esc(err.message)}</p>`; return; }
  const p = d.payment;
  const e = p.extracted || {};
  const shot = !p.hasScreenshot ? '<p class="muted">Kein Screenshot gespeichert.</p>'
    : p.mimeType === 'application/pdf'
      ? `<iframe src="/api/payments/${encodeURIComponent(p.id)}/screenshot" title="Beleg"></iframe><p><a href="/api/payments/${encodeURIComponent(p.id)}/screenshot" target="_blank">PDF öffnen</a></p>`
      : `<a href="/api/payments/${encodeURIComponent(p.id)}/screenshot" target="_blank"><img src="/api/payments/${encodeURIComponent(p.id)}/screenshot" alt="Beleg"></a>`;
  const kv = (k, v) => `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? '–' : esc(v)}</dd>`;
  const actions = [];
  if (['NEEDS_REVIEW', 'REJECTED', 'SUPERSEDED'].includes(p.status)) actions.push('<button class="ok" data-act="approve">Bestätigen</button>');
  if (['NEEDS_REVIEW', 'SUPERSEDED'].includes(p.status)) actions.push('<button class="danger" data-act="reject">Ablehnen</button>');
  if (p.status === 'VERIFIED') actions.push('<button data-act="resend-link">Link erneut senden</button>');

  bg.querySelector('.modal').innerHTML = `
    <button class="close" aria-label="Schließen">×</button>
    <h2>${esc(p.name || 'Unbekannt')} · ${esc(p.coachingName)} ${statusPill(p.status)}</h2>
    <p class="muted">Zahlung ${esc(p.id)} · Kunde ${esc(p.customerId)} · ${esc(p.phone)} · eingegangen ${dateTime(p.receivedAt)}${p.decidedAt ? ` · entschieden ${dateTime(p.decidedAt)} (${p.decidedBy === 'auto' ? 'automatisch' : 'Admin'})` : ''}${p.supersededBy ? ` · ersetzt durch ${esc(p.supersededBy)}` : ''}</p>
    ${p.reasons.length ? `<div class="banner warn"><b>Gründe für die Prüfung:</b><ul class="reasons">${p.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
    <div class="row" style="margin-bottom:14px">${actions.join('')}<span id="actMsg" class="muted"></span></div>
    <div class="detail-grid">
      <div class="shot">${shot}</div>
      <div>
        <div class="card"><h2>Erkannte Daten</h2><dl class="kv">
          ${kv('Zahlungsbeleg', e.isPaymentReceipt === undefined ? null : e.isPaymentReceipt ? 'ja' : 'nein')}
          ${kv('Empfänger', e.recipientName)}${kv('Empfänger-IBAN', e.recipientIban)}
          ${kv('Betrag', e.amount == null ? null : `${e.amount} ${e.currency || ''}`)}${kv('Erwartet', euro(p.expectedAmount, p.currency))}
          ${kv('Datum (Beleg)', [e.date, e.time].filter(Boolean).join(' '))}${kv('Zahlungsdatum', dateDE(p.paymentDate))}
          ${kv('Absender', p.name)}${kv('Verwendungszweck', e.reference)}${kv('Bank / App', e.bankApp)}
          ${kv('KI-Einschätzung', [e.transferCompleted === false ? 'nicht abgeschlossen' : e.transferCompleted ? 'ausgeführt' : null, e.recipientIsExpected === false ? 'Empfänger passt nicht' : e.recipientIsExpected ? 'Empfänger passt' : null, e.suspicious ? 'verdächtig' : null, e.aiNotes].filter(Boolean).join(' · '))}
          ${kv('WhatsApp-Name', d.customer?.pushName)}${kv('Gruppenlink gesendet', p.linkSent ? 'ja' : 'nein')}
        </dl></div>
        <div class="card"><h2>Prüfungen</h2><ul class="checks">
          ${(p.checks || []).map((c) => `<li class="${c.ok ? 'ok' : 'fail'}">${c.ok ? '✓' : '✗'} ${esc(c.label)}${c.detail ? ` – <span>${esc(c.detail)}</span>` : ''}</li>`).join('') || '<li class="muted">Keine automatischen Prüfungen.</li>'}
        </ul></div>
        ${d.otherPayments.length ? `<div class="card"><h2>Weitere Belege dieses Kunden</h2>${d.otherPayments.map((o) => `<div class="row"><a href="#" data-open="${esc(o.id)}">${esc(o.id)}</a> ${esc(o.coachingName)} ${euro(o.amount, o.currency)} ${statusPill(o.status)}</div>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="card"><h2>Chatverlauf</h2><div class="chat">
      ${renderChat(d.chat)}
    </div></div>`;
  const chat = bg.querySelector('.chat'); chat.scrollTop = chat.scrollHeight;
  bg.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); if (a.dataset.open === p.id) return; close(); openPayment(a.dataset.open, onChange); }));
  bg.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    const question = { approve: 'Der Kunde bekommt automatisch den Gruppenlink per WhatsApp.', reject: 'Der Kunde wird per WhatsApp gebeten, einen gültigen Beleg zu schicken.', 'resend-link': 'Der Kunde bekommt den Gruppenlink noch einmal per WhatsApp.' }[act];
    const titles = { approve: 'Zahlung bestätigen?', reject: 'Zahlung ablehnen?', 'resend-link': 'Link erneut senden?' };
    const oks = { approve: 'Ja, bestätigen', reject: 'Ja, ablehnen', 'resend-link': 'Ja, senden' };
    if (!(await ui.confirm(question, { title: titles[act], ok: oks[act], danger: act === 'reject', icon: act === 'approve' ? '✅' : act === 'reject' ? '⛔' : '🔗' }))) return;
    bg.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
    const msg = bg.querySelector('#actMsg');
    msg.textContent = 'Wird ausgeführt… (Tippen-Anzeige 2–3 Sek.)';
    try {
      const r = await api(`/api/payments/${encodeURIComponent(p.id)}/${act}`, { method: 'POST', body: '{}' });
      if (r.warning) ui.toast(r.warning, 'warn', 8000);
      else ui.toast({ approve: 'Bestätigt – der Kunde hat den Gruppenlink bekommen.', reject: 'Abgelehnt – der Kunde wurde informiert.', 'resend-link': 'Link wurde erneut gesendet.' }[act], 'ok');
      close();
      onChange && onChange();
    } catch (err) {
      msg.textContent = '';
      ui.toast(err.message, 'err', 8000);
      bg.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
    }
  }));
}
