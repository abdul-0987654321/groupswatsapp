'use strict';
/**
 * Works out which coaching a customer means. Keyword match first (free, instant),
 * OpenAI only as a fallback. OpenAI may only answer with one code (C1 / C2 / … / UNKNOWN);
 * anything else is treated as UNKNOWN. The customer never sees a list of coachings.
 */

const { coachings } = require('./config');
const ai = require('./ai');
const log = require('./log');

// Endings that may be glued to a keyword in German compounds ("Sportcoaching", "Geldkurs").
const COMPOUND_SUFFIXES = ['coaching', 'coachings', 'kurs', 'gruppe', 'paket', 'programm', 's'];
// Messages that are only a greeting never need the AI.
const GREETINGS = new Set([
  'hallo', 'hi', 'hey', 'hello', 'moin', 'servus', 'guten', 'tag', 'morgen', 'abend', 'abends', 'gruss', 'gott',
  'gruezi', 'salam', 'selam', 'na', 'yo', 'info', 'infos', 'frage', 'start', 'ok', 'okay', 'danke', 'bitte',
]);

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(text) {
  return normalize(text).split(' ').filter(Boolean);
}

/** Damerau-Levenshtein distance (optimal string alignment), for typo tolerance. */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function tokenMatchesKeyword(token, kw) {
  if (token === kw) return true;
  if (token.startsWith(kw) && COMPOUND_SUFFIXES.includes(token.slice(kw.length))) return true;
  // German compounds drop a final "e": "Sprache" → "Sprachcoaching"
  if (kw.endsWith('e') && kw.length >= 5) {
    const stem = kw.slice(0, -1);
    const rest = token.slice(stem.length);
    if (token.startsWith(stem) && rest.length > 1 && COMPOUND_SUFFIXES.includes(rest)) return true;
  }
  // Typos: only for keywords of 5+ letters, so short words like "lang"/"main" never match "lange"/"mainz".
  if (kw.length >= 5 && Math.abs(token.length - kw.length) <= 1 && editDistance(token, kw) <= 1) return true;
  return false;
}

/** Returns the ids of all coachings whose keywords appear in the text. */
function keywordMatches(text) {
  const toks = tokens(text);
  const hits = [];
  for (const c of coachings) {
    const kws = c.keywords.map(normalize).filter(Boolean);
    if (toks.some((t) => kws.some((kw) => tokenMatchesKeyword(t, kw)))) hits.push(c.id);
  }
  return hits;
}

function isOnlyGreeting(text) {
  const toks = tokens(text);
  return toks.length === 0 || toks.every((t) => GREETINGS.has(t));
}

async function askAI(text) {
  const client = ai.getClient();
  if (!client) return 'UNKNOWN';
  const codes = coachings.map((c) => c.id);
  const options = coachings.map((c) => `${c.id} = ${c.name} (Stichwörter: ${c.keywords.join(', ')})`).join('\n');
  try {
    const res = await client.chat.completions.create({
      model: ai.MODEL,
      temperature: 0,
      max_tokens: 5,
      messages: [
        {
          role: 'system',
          content:
            'Du ordnest WhatsApp-Nachrichten von Kunden einem Coaching zu. Mögliche Coachings:\n' +
            options +
            `\n\nAntworte AUSSCHLIESSLICH mit genau einem Code: ${codes.join(', ')} oder UNKNOWN. ` +
            'Antworte UNKNOWN, wenn die Nachricht nicht eindeutig ein bestimmtes Coaching meint ' +
            '(z. B. Begrüßung, Fragen nach allen Angeboten, mehrere Coachings). Keine anderen Wörter.',
        },
        { role: 'user', content: String(text).slice(0, 500) },
      ],
    });
    const answer = String(res.choices?.[0]?.message?.content || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return codes.includes(answer) ? answer : 'UNKNOWN';
  } catch (err) {
    log.warn(`OpenAI coaching detection failed: ${err.message}`);
    return 'UNKNOWN';
  }
}

/**
 * Detects the coaching for a message. Returns { id: 'C1' | … | null, source: 'keyword' | 'ai' | 'none' }.
 * `useAI: false` restricts detection to keywords (used when switching coaching mid-payment).
 */
async function detectCoaching(text, { useAI = true } = {}) {
  const hits = keywordMatches(text);
  if (hits.length === 1) return { id: hits[0], source: 'keyword' };
  if (!useAI || isOnlyGreeting(text)) return { id: null, source: 'none' };
  const code = await askAI(text);
  return code === 'UNKNOWN' ? { id: null, source: 'ai' } : { id: code, source: 'ai' };
}

module.exports = { detectCoaching, keywordMatches, normalize, editDistance, isOnlyGreeting };
