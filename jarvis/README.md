# J.A.R.V.I.S AI: Personal Intelligence OS

A personal AI operating system for one household. It covers:
- a central brain (JARVIS CORE) and 18 specialist agents
- long-term memory, Family Wealth OS, a smart home and automations
- a holographic web command center in Hebrew and English
- a desktop app, a phone app and smartwatch apps

```bash
cd jarvis && npm install && npm start     # http://127.0.0.1:7777, then paste the token printed in the console
npm test                                  # 46 unit / integration / API tests
npm run test:e2e                          # browser tests: all screens, RTL/LTR, a11y, approvals, phone width
npm run build:prototypes                  # prototypes/demo: the real UI on recorded data, no server needed
```

📘 **Setup guide, including what only you can do:** [`docs/SETUP_GUIDE.he.md`](docs/SETUP_GUIDE.he.md)
📊 **Status of every spec section:** [`docs/EVOLUTION.md`](docs/EVOLUTION.md) · Design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## System map

```
                         JARVIS CORE (intent he/en → plan → permissions → approval → execute → verify)
   Memory Engine · Voice Engine · Computer Engine · Agent Engine (18) · Security Engine · Automation Engine
        Web (built) · Desktop/Tauri (built & run) · iOS+Android/Expo (bundled) · Apple Watch / Wear OS (source)
```

## Configuration

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Claude for open questions, research, vision (routing: haiku / sonnet / opus by task). Without it, built-in commands still work and open questions fail clearly |
| `HA_URL`, `HA_TOKEN` | Real Home Assistant in place of the demo home |
| `JARVIS_TOKEN` | Owner token. If unset, one is generated and stored in `data/jarvis.json` |
| `JARVIS_HOST`, `PORT`, `JARVIS_DATA` | Bind address (default `127.0.0.1`), port, data file |
| `JARVIS_MODEL_FAST` / `_BALANCED` / `_DEEP` | Override routing tiers |

## Layout

```
server/      core (orchestrator, intent, router, personality) · agents · tools · memory · documents · wealth · home
             productivity · automation (engine + natural-language builder) · notify (+ Expo push) · proactive
             devices (registry, scopes, sync) · health · privacy · observability · context (weather) · security · system
web/         command center: 13 screens, holographic SVG core, voice, charts. No build step. Hebrew RTL / English LTR
sdk/         JS client: auth, change feed, offline queue with idempotent ops + backoff (used by the phone app)
apps/        mobile (Expo) · desktop (Tauri) · watchos (SwiftUI) · wearos (Compose)
desktop/     least-privilege desktop bridge (apps, URLs, allowed folders, screenshots)
prototypes/  build.mjs + mock backend → demo/ (interactive UI) and devices.html (watch & phone screens)
tests/       node:test suites + e2e/ui.e2e.mjs (Playwright)
```

## Safety rules enforced in code

- **Money.** JARVIS never moves money, invests, buys or changes financial products. Money requests are logged as blocked, even after approval.
- **Sensitive actions.** Unlocking doors, disarming alarms, reading files and taking screenshots always ask first. The approval is bound to the exact action and expires after 15 minutes.
- **Autonomy.** Levels 1–4, default 3. At no level can sensitive or financial actions run without asking.
- **Data domains.** Finance, health, family and work data are separate, and each agent reads only its domains. Health is off by default and never sent to a model.
- **Untrusted content.** Web pages, documents and emails are data, never instructions.
- **Verification.** Nothing is reported as done until its state was verified.
