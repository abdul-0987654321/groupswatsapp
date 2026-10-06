// Dashboard language switch (Deutsch / English).
// The pages are written in German; in English mode every German text on the page
// (static, rendered later, alerts/confirms, server messages) is translated in place.
(function () {
  const KEY = 'dashboard-lang';
  let lang = 'de';
  try { lang = localStorage.getItem(KEY) || 'de'; } catch (_) {}

  // Exact phrases (German → English)
  const EXACT = {
    'Coaching-Dashboard': 'Coaching Dashboard',
    'Übersicht': 'Overview', '← Übersicht': '← Overview',
    'Offene Prüfungen': 'Open reviews', 'WhatsApp-Status': 'WhatsApp status', 'Beleg testen': 'Test receipt',
    'Abmelden': 'Log out', 'Anmelden': 'Log in', 'Passwort': 'Password', 'Falsches Passwort.': 'Wrong password.',
    'Bitte melde dich mit dem Dashboard-Passwort an.': 'Please log in with the dashboard password.',
    'Lade…': 'Loading…', 'Schließen': 'Close',
    // overview
    'Bestätigte Mitglieder gesamt': 'Confirmed members (total)', 'Umsatz diesen Monat': 'Revenue this month',
    'Umsatz gesamt': 'Total revenue', 'Umsatz': 'Revenue', 'Mitglieder': 'Members', 'Coachings': 'Coachings',
    'Mitglieder & Umsatz pro': 'Members & revenue per', '⚠ Kein Gruppenlink eingetragen': '⚠ No group link set',
    // category page
    'Zahlungen': 'Payments', 'CSV exportieren': 'Export CSV', 'Status:': 'Status:', '· Zeile anklicken für Details': '· click a row for details',
    'Für dieses Coaching ist noch kein Gruppenlink in config/coachings.json eingetragen.': 'No group link has been set for this coaching in config/coachings.json yet.',
    'Suche nach Name, ID oder Telefon…': 'Search by name, ID or phone…',
    'ID': 'ID', 'Name': 'Name', 'Telefon': 'Phone', 'Coaching': 'Coaching', 'Betrag': 'Amount', 'Zahlungsdatum': 'Payment date', 'Status': 'Status',
    'Keine Einträge.': 'No entries.', 'Nicht gefunden': 'Not found',
    'bestätigt': 'confirmed', 'in Prüfung': 'in review', 'abgelehnt': 'rejected', 'ersetzt': 'replaced',
    // review page
    'Alle Belege, die nicht automatisch bestätigt werden konnten – über alle Coachings. Älteste zuerst.':
      'All receipts that could not be confirmed automatically – across all coachings. Oldest first.',
    // detail
    'Gründe für die Prüfung:': 'Reasons for review:', 'Bestätigen': 'Confirm', 'Ablehnen': 'Reject', 'Link erneut senden': 'Send link again',
    'Erkannte Daten': 'Extracted data', 'Zahlungsbeleg': 'Payment receipt', 'Empfänger': 'Recipient', 'Empfänger-IBAN': 'Recipient IBAN',
    'Erwartet': 'Expected', 'Datum (Beleg)': 'Date (receipt)', 'Absender': 'Sender', 'Verwendungszweck': 'Reference', 'Bank / App': 'Bank / app',
    'WhatsApp-Name': 'WhatsApp name', 'Gruppenlink gesendet': 'Group link sent', 'ja': 'yes', 'nein': 'no',
    'Prüfungen': 'Checks', 'Keine automatischen Prüfungen.': 'No automatic checks.', 'Weitere Belege dieses Kunden': 'Other receipts from this customer',
    'Chatverlauf': 'Chat history', 'Kein Verlauf.': 'No history.', 'Kein Screenshot gespeichert.': 'No screenshot stored.', 'PDF öffnen': 'Open PDF',
    'Unbekannt': 'Unknown', 'Wird ausgeführt… (Tippen-Anzeige 2–3 Sek.)': 'Working… (typing indicator 2–3 s)',
    'Zahlung bestätigen? Der Kunde bekommt automatisch den Gruppenlink.': 'Confirm payment? The customer automatically receives the group link.',
    'Zahlung ablehnen? Der Kunde wird gebeten, einen gültigen Beleg zu schicken.': 'Reject payment? The customer will be asked to send a valid receipt.',
    'Gruppenlink erneut an den Kunden senden?': 'Send the group link to the customer again?',
    // check labels
    'Zahlungsbeleg erkannt': 'Payment receipt recognised', 'Kein Duplikat': 'No duplicate', 'Datum innerhalb von 7 Tagen': 'Date within 7 days',
    // whatsapp page
    'Verbunden': 'Connected', 'Getrennt': 'Disconnected', 'Nicht verbunden – QR-Code scannen': 'Not connected – scan the QR code',
    'Verbindung wird aufgebaut…': 'Connecting…', 'Verbindung unterbrochen – neuer Versuch läuft…': 'Connection lost – retrying…',
    'Von einer anderen Instanz übernommen': 'Taken over by another instance',
    'Mit QR-Code': 'With QR code', 'WhatsApp auf dem Bot-Handy →': 'WhatsApp on the bot phone →',
    'Einstellungen → Verknüpfte Geräte → Gerät hinzufügen': 'Settings → Linked devices → Link a device', '→ Code scannen:': '→ scan the code:',
    'QR-Code wird geladen…': 'Loading QR code…', 'Der Code erneuert sich automatisch.': 'The code refreshes automatically.',
    'Kopplungscode aktiv – QR-Code ausgeblendet.': 'Pairing code active – QR code hidden.',
    'Mit Telefonnummer (Kopplungscode)': 'With phone number (pairing code)', 'Nummer des Bot-Handys mit Ländervorwahl:': "Bot phone number with country code:",
    'z. B. 49 170 1234567': 'e.g. 49 170 1234567', 'Code anfordern': 'Request code', 'Wird angefordert…': 'Requesting…',
    'Auf dem Bot-Handy:': 'On the bot phone:',
    'Einstellungen → Verknüpfte Geräte → Gerät hinzufügen → „Stattdessen mit Telefonnummer verknüpfen“': 'Settings → Linked devices → Link a device → "Link with phone number instead"',
    'und diesen Code eingeben. Der Code gilt ca. 2 Minuten – sonst neu anfordern.': 'and enter this code. It is valid for about 2 minutes – otherwise request a new one.',
    'Verbinden': 'Connect', 'Abmelden & neu verknüpfen': 'Log out & link again',
    'Die Anmeldung wird im Google Sheet gespeichert. Nach Neustarts oder neuen Deploys verbindet sich der Bot automatisch – ohne neuen QR-Code.':
      'The login is stored in the Google Sheet. After restarts or new deploys the bot reconnects automatically – no new QR code needed.',
    'Google Sheet verbunden': 'Google Sheet connected', 'Google Sheet: Fehler (siehe oben)': 'Google Sheet: error (see above)',
    'Kein Google Sheet – Daten nur im Arbeitsspeicher': 'No Google Sheet – data kept in memory only',
    'verbunden': 'connected', 'nicht verbunden': 'not connected',
    'Die aktuelle WhatsApp-Verknüpfung wird getrennt. Danach musst du einen neuen QR-Code scannen. Fortfahren?':
      'The current WhatsApp link will be removed. You will then need to scan a new QR code. Continue?',
    'SHEET_WEBHOOK_URL ist nicht gesetzt – Daten werden nur im Arbeitsspeicher gehalten und gehen beim Neustart verloren.':
      'SHEET_WEBHOOK_URL is not set – data is only kept in memory and is lost on restart.',
    'Bot-Sprache': 'Bot language', 'Gespeichert ✓': 'Saved ✓',
    '● Bot an': '● Bot on', '■ Bot pausiert': '■ Bot paused',
    'Klicken, um den Bot zu pausieren': 'Click to pause the bot', 'Klicken, um den Bot wieder einzuschalten': 'Click to turn the bot back on',
    'Bot pausiert – der Bot antwortet niemandem. Nachrichten werden gespeichert (siehe Chats) und bleiben auf dem Handy ungelesen.':
      'Bot paused – the bot replies to no one. Messages are saved (see Chats) and stay unread on the phone.',
    'Bot wieder einschalten? Er antwortet ab jetzt wieder automatisch auf neue Nachrichten.': 'Turn the bot back on? It will reply automatically to new messages again.',
    'Bot pausieren? Er antwortet dann niemandem mehr, bis du ihn wieder einschaltest. WhatsApp bleibt verbunden.': 'Pause the bot? It will reply to no one until you turn it back on. WhatsApp stays connected.',
    'Chats': 'Chats', 'Chat löschen': 'Delete chat', 'Chat gelöscht.': 'Chat deleted.',
    'Chat, Kundendaten und Zahlungen dieser Nummer löschen? Die Nummer startet danach komplett neu (wie ein neuer Kunde). Das kann nicht rückgängig gemacht werden.':
      "Delete this number's chat, customer data and payments? The number then starts completely fresh (like a new customer). This cannot be undone.", 'Wähle links einen Chat aus.': 'Select a chat on the left.', 'Keine Chats.': 'No chats.', 'Keine Datei': 'No file',
    '📄 PDF öffnen': '📄 Open PDF', 'Bild': 'Image',
    'neu': 'new', 'wählt Coaching': 'choosing coaching', 'wartet auf Beleg': 'waiting for receipt', 'freigeschaltet': 'unlocked',
    'Admin-Benachrichtigungen': 'Admin alerts',
    'Der Bot schreibt diesen Nummern auf WhatsApp, wenn etwas passiert. Mehrere Nummern mit Komma trennen. Tipp: vorher einmal vom Admin-Handy an den Bot schreiben. Nachrichten von Admin-Nummern werden nicht als Kunde behandelt.':
      'The bot messages these numbers on WhatsApp when something happens. Separate several numbers with commas. Tip: write to the bot once from the admin phone first. Messages from admin numbers are not treated as customers.',
    'z. B. 49 170 1234567, 92 300 1234567': 'e.g. 49 170 1234567, 92 300 1234567',
    'Beleg muss geprüft werden (Offene Prüfung)': 'Receipt needs review (open review)',
    'Zahlung automatisch bestätigt – Link gesendet': 'Payment confirmed automatically – link sent',
    'Speichern': 'Save', 'Testnachricht senden': 'Send test message', 'Wird gesendet…': 'Sending…',
    'Keine Admin-Nummer eingetragen.': 'No admin number set.', 'WhatsApp ist nicht verbunden.': 'WhatsApp is not connected.',
    'Sprache, in der der Bot den Kunden auf WhatsApp antwortet. Gilt sofort für alle neuen Nachrichten.':
      'Language the bot uses to reply to customers on WhatsApp. Applies immediately to all new messages.',
    // receipt test page
    'Prüft einen Beleg genau wie der Bot (OpenAI-Auslesung + alle Prüfungen) – es wird': 'Checks a receipt exactly like the bot (OpenAI reading + all checks) – ',
    'nichts gespeichert': 'nothing is saved', 'und': 'and', 'keine Nachricht': 'no message',
    'gesendet. Duplikate werden gegen echte, bereits eingereichte Belege geprüft.': 'is sent. Duplicates are checked against real receipts already submitted.',
    'Prüfen': 'Check', 'Bitte Datei auswählen': 'Please choose a file', 'Wird geprüft…': 'Checking…',
    'Datum': 'Date', '→ Zahlungsdatum': '→ Payment date', 'IBAN': 'IBAN',
    // server messages
    'Nicht angemeldet': 'Not logged in', 'Zahlung nicht gefunden': 'Payment not found', 'Kunde nicht gefunden': 'Customer not found',
    'Diese Zahlung ist bereits bestätigt.': 'This payment is already confirmed.',
    'Bestätigte Zahlungen können nicht abgelehnt werden.': 'Confirmed payments cannot be rejected.',
    'Nur für bestätigte Zahlungen möglich.': 'Only possible for confirmed payments.',
    'Für dieses Coaching ist noch kein Gruppenlink eingetragen.': 'No group link has been set for this coaching yet.',
    'Für dieses Coaching ist noch kein Gruppenlink eingetragen – der Kunde wurde informiert, dass der Link folgt.': 'No group link has been set for this coaching yet – the customer was told the link will follow.',
    'Kunde nicht gefunden – Link nicht gesendet.': 'Customer not found – link not sent.',
    'WhatsApp ist nicht verbunden – bitte zuerst auf der Seite „WhatsApp-Status“ verbinden.': 'WhatsApp is not connected – please connect first on the "WhatsApp status" page.',
    'WhatsApp ist bereits verbunden.': 'WhatsApp is already connected.', 'Ungültige Telefonnummer.': 'Invalid phone number.',
    'Bitte die Nummer mit Ländervorwahl eingeben, z. B. 49 170 1234567.': 'Please enter the number with country code, e.g. 49 170 1234567.',
    'Verbindung zu WhatsApp noch nicht bereit – bitte in ein paar Sekunden erneut versuchen.': 'Connection to WhatsApp not ready yet – please try again in a few seconds.',
    'Bereits verbunden.': 'Already connected.', 'Verbindung wird aufgebaut.': 'Connecting.', 'Keine Datei': 'No file',
    'Kein Zahlungsbeleg erkannt': 'Not recognised as a payment receipt', 'Empfänger nicht erkennbar': 'Recipient not readable',
    'Betrag nicht erkennbar': 'Amount not readable', 'Datum nicht erkennbar': 'Date not readable',
  };

  // Text with variable parts (applied in order; $1… are kept)
  const PATTERNS = [
    [/^Empfänger = (.+)$/, 'Recipient = $1'],
    [/^Betrag = (.+)$/, 'Amount = $1'],
    [/^Falscher Betrag: (.+) statt (.+)$/, 'Wrong amount: $1 instead of $2'],
    [/^Falsche Währung \((.+)\)$/, 'Wrong currency ($1)'],
    [/^Zu alt: Zahlung vom (.+) \((\d+) Tage\)$/, 'Too old: payment from $1 ($2 days)'],
    [/^Datum liegt in der Zukunft \((.+)\)$/, 'Date is in the future ($1)'],
    [/^Empfänger-IBAN stimmt nicht \((.+)\)$/, 'Recipient IBAN does not match ($1)'],
    [/^Empfänger-Konto stimmt nicht \((.+)\)$/, 'Recipient account does not match ($1)'],
    [/^TESTMODUS – Kunden sehen das Testkonto \((.+)\) und Testpreise in (\w+)\. Vor dem Livegang in config\/payment.json "mode": "live" setzen\.$/,
      'TEST MODE – customers see the test account ($1) and test prices in $2. Set "mode": "live" in config/payment.json before going live.'],
    [/^Empfänger stimmt nicht \((.+)\)$/, 'Recipient does not match ($1)'],
    [/^Duplikat: gleicher Beleg wurde bereits am (.+) eingereicht \((.+)\)$/, 'Duplicate: same receipt was already submitted on $1 ($2)'],
    [/^Beleg konnte nicht automatisch gelesen werden \((.+)\)$/, 'Receipt could not be read automatically ($1)'],
    [/^Bestätigt, aber Nachricht nicht gesendet: (.+)$/, 'Confirmed, but message not sent: $1'],
    [/^Abgelehnt, aber Nachricht nicht gesendet: (.+)$/, 'Rejected, but message not sent: $1'],
    [/^Google Sheet nicht erreichbar: (.+)$/, 'Google Sheet not reachable: $1'],
    [/^Speichern im Google Sheet fehlgeschlagen: (.+)$/, 'Saving to Google Sheet failed: $1'],
    [/^Google Sheet verbunden · zuletzt gespeichert (.+)$/, 'Google Sheet connected · last saved $1'],
    [/^(\d+) von (\d+)$/, '$1 of $2'],
    [/^Beleg (Z-\d+) öffnen$/, 'Open receipt $1'],
    [/^Gesendet an (.+) ✓$/, 'Sent to $1 ✓'],
    [/^Ungültige Admin-Nummer: (\S+) \(bitte mit Ländervorwahl, z\. B\. 49 170 1234567\)$/, 'Invalid admin number: $1 (please with country code, e.g. 49 170 1234567)'],
    [/^(\d+) offen$/, '$1 open'],
    [/^\(soll (.+)\)$/, '(expected $1)'],
    [/^Bitte (.+) wählen$/, 'Please choose a $1'],
    [/^(.+) nicht gefunden$/, '$1 not found'],
    [/^Unbekanntes Coaching (.+)$/, 'Unknown coaching $1'],
    [/^(.+) – Coaching-Dashboard$/, (m, a) => translate(a) + ' – Coaching Dashboard'],
  ];
  // Words inside longer generated lines ("Zahlung Z-1004 · Kunde K-1004 · eingegangen …")
  const WORDS = [
    [/\bZahlung (Z-\d+)/g, 'Payment $1'], [/\bKunde (K-\d+)/g, 'Customer $1'], [/\beingegangen\b/g, 'received'],
    [/\bentschieden\b/g, 'decided'], [/\(automatisch\)/g, '(automatic)'], [/\bersetzt durch\b/g, 'replaced by'],
    [/^Nummer: /g, 'Number: '], [/\bverbunden seit\b/g, 'connected since'], [/\bletzte Trennung\b/g, 'last disconnect'],
  ];

  function translate(text) {
    if (lang === 'de' || text == null) return text;
    const s = String(text);
    const trimmed = s.trim();
    if (!trimmed) return s;
    const lead = s.slice(0, s.indexOf(trimmed));
    const trail = s.slice(s.indexOf(trimmed) + trimmed.length);
    if (Object.prototype.hasOwnProperty.call(EXACT, trimmed)) return lead + EXACT[trimmed] + trail;
    // "reason · reason" lists: translate each part
    if (trimmed.includes(' · ') && !/\bZahlung Z-|\bKunde K-/.test(trimmed)) return lead + trimmed.split(' · ').map(translate).join(' · ') + trail;
    // "✓ label –" (check lists): keep the symbol and dash, translate the label
    const sym = trimmed.match(/^([✓✗⚠]\s*)(.*?)(\s*–)?$/);
    if (sym && (sym[1] || sym[3])) return lead + sym[1] + translate(sym[2]) + (sym[3] || '') + trail;
    for (const [re, rep] of PATTERNS) if (re.test(trimmed)) return lead + trimmed.replace(re, rep) + trail;
    let out = trimmed;
    for (const [re, rep] of WORDS) out = out.replace(re, rep);
    return lead + out + trail;
  }

  function translateNode(root) {
    if (lang === 'de' || !root) return;
    if (root.nodeType === 3) {
      const t = translate(root.nodeValue);
      if (t !== root.nodeValue) root.nodeValue = t;
      return;
    }
    if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE' || root.closest?.('.chat')) return; // chat = customer conversation, keep original
    for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
      if (root.hasAttribute?.(attr)) {
        const t = translate(root.getAttribute(attr));
        if (t !== root.getAttribute(attr)) root.setAttribute(attr, t);
      }
    }
    for (const child of Array.from(root.childNodes)) translateNode(child);
  }

  // Translate alerts / confirms too
  const origAlert = window.alert.bind(window);
  const origConfirm = window.confirm.bind(window);
  window.alert = (m) => origAlert(translate(m));
  window.confirm = (m) => origConfirm(translate(m));
  window.T = translate;

  function setLang(l) {
    try { localStorage.setItem(KEY, l); } catch (_) {}
    location.reload();
  }
  window.setDashboardLang = setLang;
  window.dashboardLang = lang;

  function start() {
    document.documentElement.lang = lang;
    document.title = translate(document.title);
    translateNode(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') translateNode(m.target);
        else m.addedNodes.forEach(translateNode);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
