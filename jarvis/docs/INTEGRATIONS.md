# Real integrations (`server/integrations/`)

Every connector calls the service's real public API. A connector's status comes only from what
actually happened:

| Status | Meaning |
|---|---|
| `not_configured` | credentials or settings are missing |
| `configured` | saved, not tested yet (or nothing harmless to test) |
| `connected` | the last real call succeeded; the card shows the time and what the service answered |
| `failed` | the last real call failed; the card shows the service's own error |

## Connectors

| Connector | What JARVIS can do | Say | Needs |
|---|---|---|---|
| **Make** | list scenarios, run a scenario (`POST /api/v2/scenarios/{id}/run`), send data to Make webhooks | "הפעל את התרחיש סיכום יומי", "אילו תרחישים יש לי", "שלח ל-Make: …" | API token (scopes `scenarios:read`, `scenarios:run`), zone (eu1…), team id; webhooks as `name \| url` |
| **Telegram** | send a message to *your own* chat; optionally forward JARVIS notifications | "שלח לי לטלגרם: לקנות חלב" | bot token from @BotFather; send `/start` to the bot, then press "Find my chat" |
| **Airtable** | list records, add a record (verified by reading it back) | "הוסף ל-Airtable: לתקן את הדלת", "show my airtable" | personal access token (`data.records:read/write`, `schema.bases:read`), base id, table |
| **Exchange rates** | live ECB reference rates (frankfurter.dev) | "כמה זה 100 דולר בשקלים", "שער היורו" | nothing |
| **Wikipedia** | article summary with its link (he/en) | "חפש בוויקיפדיה …"; with no AI model, "מי היה …" / "what is …" are answered from Wikipedia | nothing |
| **News (RSS)** | headlines from ynet, BBC or any feeds you add; a failing feed is named, not hidden | "חדשות", "חדשות ynet" | nothing |
| **Weather** | current weather for your location (Open-Meteo) | "מה מזג האוויר" | location in Preferences |
| **Shabbat & holidays (Hebcal)** | candle lighting, havdalah, parasha, upcoming holidays (Hanukkah shown as one line), today's Hebrew date; times are those of the saved location, not the server's | "מתי כניסת שבת", "מתי החג הבא", "מה התאריך העברי" | nothing |
| **Crypto (CoinGecko)** | price in ₪ and $ with the 24 h change | "כמה עולה ביטקוין", "מחיר ביטקוין ואתריום" | nothing |
| **Phone push (ntfy)** | push to your phone through the free ntfy app; optionally every JARVIS notification | "שלח לי התראה לטלפון: …" | a long random topic (a "Random" button is provided) or your own ntfy server + token |
| **Calendar (iCal)** | your Google/Outlook/Apple calendar synced read-only every 30 min (60 days ahead, recurring events, cancelled events skipped). The address is a secret and is masked. | "סנכרן את היומן", "מה יש לי ביומן" | the calendar's secret iCal address |
| **GitHub** | open issues (PRs excluded), creating an issue (verified by reading it back) | "my github issues", "פתח issue: …" | fine-grained token (Issues read/write) |
| **Incoming webhook** | Make or any service POSTs `{"action":"notify\|task\|note","text":"…"}` to a private URL | n/a | JARVIS server reachable from the internet (e.g. a tunnel) |

## Safety

- **Tokens** are stored on the JARVIS server and the API never returns them, only a masked hint
  (`••••abcd`). Environment variables override stored values: `TELEGRAM_BOT_TOKEN`,
  `MAKE_API_TOKEN`, `AIRTABLE_TOKEN`.
- **Risk levels:** every action runs through the permission policy and is written to the audit
  trail. Telegram, Make and Airtable actions are `external`; reads are `read`.
- **Who receives messages:** only the owner's own Telegram chat. Sending to other people is not
  offered.
- **Webhook URLs** must be `https://`. Private-network addresses are refused (localhost,
  10.x, 192.168.x, 172.16–31.x, .local, .internal).
- **Incoming webhook:**
  - It is authenticated by its own random 36-character token, and creating a new URL revokes the old one.
  - It is limited to 30 calls a minute.
  - It can only notify, add a task or add a note. It can never run commands, move money or control devices.
- **Make runs:** in the UI, running a Make scenario asks for confirmation, because the scenario
  does real things (for example, sends email).

## Where it works

Outside calls go from wherever JARVIS runs.

| Where JARVIS runs | Outside calls |
|---|---|
| Server (`npm start`) | They work. This is the full experience. |
| Browser build or single HTML file | Services that allow browser calls work, such as Telegram, Airtable, Wikipedia and Frankfurter. Others are blocked by the browser. |
| claude.ai | The sandbox may block the calls. |

In each case the card shows the exact error.

## Verification

| Check | How | Result |
|---|---|---|
| `tests/integrations.test.js` (8 tests) | A recorder returns each service's documented response shapes, including real error forms (Telegram 401, Make IM005, Airtable AUTHENTICATION_REQUIRED). Checks the exact requests JARVIS sends, verification by reading back, token masking, private-URL refusal, the incoming webhook's limits, intent routing and wake-word sensitivity. | pass |
| `tests/e2e/ui.e2e.mjs`, Integrations | In a real browser: a wrong token is refused, an offline service shows its real error, and the saved token never appears in the page. | pass |
| Live, 21/11/2026, from a cloud container | Exchange rates: 100 USD = 334.28 ILS (ECB, 20/11) | real response |
| | News: live ynet and BBC headlines | real response |
| | Wikipedia and Open-Meteo: blocked (429 / timeout) | the services' limits on datacenter IPs; on a home connection they answer normally |
| Telegram, Make API, Airtable | Need your own tokens, so they could not be called live here | not tested live |

### Live check, 24/11/2026

From a cloud container, through JARVIS's own commands:

| Service | Result |
|---|---|
| Hebcal: Shabbat | Tel Aviv, candle lighting Friday 27.11 16:16, havdalah 17:16, Parashat Vayishlach |
| Hebcal: holidays | Hanukkah 4.12–12.12, Tu BiShvat 23.1, Purim 23.3 |
| Hebcal: Hebrew date | "י״ד בְּכִסְלֵו תשפ״ז" |
| CoinGecko | bitcoin ₪199,788 ($59,647, ▼4.82% in 24 h) |
| ntfy.sh | Refused with "daily message quota reached" (429). That is the limit on the container's shared IP; from a home connection the same call works. |

Connecting from anywhere (HTML file, phone, public address) is covered in [DEPLOY.he.md](DEPLOY.he.md).
