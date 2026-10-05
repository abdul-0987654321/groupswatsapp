# Coaching Payment Bot

A WhatsApp bot (Baileys) for paid coachings. Customers message the number privately, pick a coaching, pay by bank transfer and send a screenshot. The bot checks the receipt (OpenAI vision plus rules in code) and sends the invite link to the paid group. Everything the customer sees is in German, and so is the dashboard.

## Change prices, keywords and group links

**`config/coachings.json` is the only file you need to edit:**

```json
{
  "C1":   { "name": "Sport Coaching", "keywords": ["sport"], "price": 75, "groupLink": "https://chat.whatsapp.com/XXXX" },
  "C2":   { "name": "Money Coaching", "keywords": ["money", "geld"], "price": 80, "groupLink": "" },
  "C3":   { "name": "Lang Coaching",  "keywords": ["lang", "sprache", "language"], "price": 85, "groupLink": "" },
  "MAIN": { "name": "Main Coaching",  "keywords": ["main", "haupt"], "price": 90, "groupLink": "" }
}
```

| Field | Meaning |
|---|---|
| `name` | Shown to the customer ("Das Sport Coaching kostet …") and in the dashboard. |
| `keywords` | Words that pick this coaching, case-insensitive. German compounds ("Sportcoaching") and small typos ("sprot") are recognised. Keywords under 5 letters must match exactly, so "lang" doesn't match "lange". If no keyword matches, OpenAI is asked, and it may only answer with a code. |
| `price` | Price in EUR. The amount on the receipt must equal this exactly. |
| `groupLink` | WhatsApp group invite link. If it's empty, a verified customer is told the link follows shortly. They get it automatically the next time they write, or when you click "Link erneut senden" in the dashboard. |

You can add or remove coachings. The key (`C1`, `MAIN`, …) is the internal code and should not change once payments exist for it. The dashboard creates a tile for every entry.

**How to apply a change:** edit the file on GitHub (pencil icon → "Commit changes"). Render redeploys automatically in about 2–3 minutes. WhatsApp reconnects from the stored session, so no new QR code is needed, and conversations in progress are kept.

The bank details are in `config/payment.json` and are never written by the AI.

## Test mode vs. live mode
`config/payment.json` holds two payment profiles:

- **`live`**: the client's account (Ilyas Lang, IBAN, EUR) with the prices from `coachings.json`.
- **`test`**: your own test account (for example a Pakistani bank or wallet number, PKR) with tiny test prices (`"prices": { "C1": 1, "C2": 2, "C3": 3, "MAIN": 4 }`).

Set `"mode": "test"` or `"mode": "live"` and commit; Render redeploys by itself. In test mode the dashboard shows a red **TESTMODUS** banner. For test accounts, `accountType: "account"` makes the bot show "Kontonummer / Account number + Bank" instead of "IBAN". Number formats like `0300…`, `+92 300…`, masked `****4567`, or an IBAN that ends in the account number all count as a match.

**Going live:**
1. Set `"mode": "live"` and commit.
2. In the Google Sheet, delete the data rows (keep the header row) in the tabs `customers`, `payments` and `chat`. **Do not touch `session`**, or WhatsApp is logged out.
3. Restart the service on Render (Manual Deploy).

## Setup (once)

### 1. Google Sheet as storage
Render's free tier has no persistent disk. All data is kept in a Google Sheet: the WhatsApp session, customers, payments and chat. Screenshots go to a private Google Drive folder named "Coaching-Bot Belege".

1. Create a new Google Sheet, then go to **Extensions → Apps Script**.
2. Replace the code with the contents of [`apps-script/Code.gs`](apps-script/Code.gs) and save.
3. **Project Settings → Script properties → Add**: `SECRET` = a long random string.
4. **Deploy → New deployment → Web app**. Set *Execute as: Me* and *Who has access: Anyone*, then approve the Sheets/Drive permissions.
5. Copy the web-app URL (it ends in `/exec`).

If you later change `Code.gs`, use **Deploy → Manage deployments → Edit → Version: New version**. That keeps the same URL.

### 2. Render (Web Service, Free)
- Branch: `claude/happy-fermat-z3d5j0`
- Build: `npm install`
- Start: `npm start`
- Region: Frankfurt
- Health check path: `/health`
- Environment variables (secrets only here, never in the repo; see `.env.example`):
  - `SHEET_WEBHOOK_URL` – the `/exec` URL
  - `SHEET_SECRET` – the same value as the `SECRET` script property
  - `OPENAI_API_KEY`
  - `DASHBOARD_PASSWORD`
  - `NODE_VERSION=22`
  - `TZ=Europe/Berlin`

### 3. Connect WhatsApp
Open `https://<service>.onrender.com`, log in and go to **WhatsApp-Status**. There are two ways to log in:
- **QR code:** on the bot phone, go to WhatsApp → Settings → Linked devices → Link a device, and scan the code.
- **Pairing code:** enter the bot's number with country code (e.g. `49 170 1234567`) and click "Code anfordern". On the phone, go to Linked devices → Link a device → "Link with phone number instead", and type in the 8-character code.

The login is stored in the Google Sheet. After restarts or deploys the bot reconnects without a new QR or pairing code. On a deploy, the new instance waits about 25 s for the old one to save its last session changes, then re-reads the session before connecting.

### 4. UptimeRobot (keeps the free service awake)
Add a new monitor:
- Type: **HTTP(s)**
- URL: `https://<service>.onrender.com/health`
- Interval: **5 minutes**

`/health` needs no login and always returns 200.

## How a receipt is checked
OpenAI (`gpt-4o-mini`) only reads the receipt fields. The decision is made in code (`src/verify.js`):

- It is a payment receipt.
- The recipient IBAN matches (spaces and masking are ignored) **or** the recipient name is "Ilyas Lang". A fully readable IBAN that is different always fails.
- The amount equals the coaching price in EUR.
- The payment date is within the last 7 days. "Heute", "Today" and "A few minutes ago" count as the day the WhatsApp message arrived.
- It is not a duplicate: not the same file, not the same picture re-compressed with the same amount, and not the same reference + amount + date + sender.

If every check passes, the payment is **VERIFIED** and the link is sent automatically. If any check fails, it goes to **NEEDS_REVIEW** with a German reason in **Offene Prüfungen**. Nothing is ever rejected automatically.

**Beleg testen** in the dashboard checks a receipt the same way, without saving anything or messaging anyone. From the command line: `node scripts/check-receipts.js <folder> --coaching MAIN` (needs `OPENAI_API_KEY`).

## WhatsApp safety rules (built in)
- Plain text only: no buttons or lists.
- The bot only replies to private messages and ignores groups, status and broadcasts. It never writes first.
- Incoming messages are marked "seen" after about 1 second, then "typing…" shows for 2–3 seconds before every reply (configurable: `READ_MIN_MS`, `READ_MAX_MS`, `TYPING_MIN_MS`, `TYPING_MAX_MS`).
- The group link is sent only after the payment is verified. Customers never see a list of all coachings.

## Development
```
npm install
cp .env.example .env   # without SHEET_WEBHOOK_URL, data stays in memory only
npm start              # http://localhost:3000
npm test
```
