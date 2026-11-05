# JARVIS Evolution: inspection, gap analysis and status

This document covers phase 1 of the evolution spec: what existed, what was missing, the order of work, and the true status of every section of both prompts (the master spec and the evolution spec). Status words mean:

- **Built & tested**: implemented and covered by automated tests in this repo.
- **Built & run**: compiled or bundled and launched here, but has no automated test.
- **Source**: real code, but not compiled here because the toolchain doesn't exist on Linux (Xcode, Android SDK).
- **Needs you**: requires an account, a device or a decision only the owner can provide. See `SETUP_GUIDE.he.md`.

## 1. What existed before the evolution (inspection)

- **Server.** A Node server with no framework, containing:
  - JARVIS CORE: explicit states, plans, approvals, verification.
  - 12 agents.
  - Typed memory with provenance.
  - Family Wealth OS calculations in integer agorot.
  - Home Assistant and demo-home adapters.
  - Tasks, calendar and reminders.
  - Automations, notifications and a proactive engine.
  - Documents and a research fetcher with an injection guard.
  - A desktop bridge.
- **Web UI.** A single-file vanilla UI, English only.
- **Tests.** 29 tests.

## 2. Gaps found against the evolution spec

| Spec section | Gap | Resolution |
|---|---|---|
| 1 Ecosystem / device registry | No device identity, no sync | Device registry with per-device scoped, revocable tokens; capability registry that labels every client built / source / planned; change feed + idempotent offline ops |
| 2 Visual design | Plain dashboard, English only | New design system (glass, glow, holographic SVG core with 8 states and a live voice ring), 13 screens covering the 10 interface modes, Hebrew RTL default + English LTR |
| 3 Smartwatch | None | Watch API (glance, quick actions), watchOS and Wear OS apps, complication/tile, HealthKit / Health Services upload |
| 4 AI core | One model call, fixed prompt | Model router by complexity/latency/privacy/vision, metered per call (latency, tokens, cost); configurable personality; multimodal input endpoint (text, image, document, audio) |
| 5 Agents | 12 agents without schemas | 18 agents with scope, tool allow-list, data domains, I/O schemas, delegation rules; tool argument validation before execution |
| 6 Autonomy | Single mode | Levels 1-4 (default 3); approvals bound to an action hash, with consequences and a 15-minute expiry; silence never counts as consent |
| 7 Memory | Vector only | Hybrid retrieval (semantic + BM25), duplicate detection, confidence, domain-scoped retrieval, off switch, default expiry for conversation summaries |
| 8 Proactive | Basic signals | Added stale projects, automation suggestions and recurring issues; every item carries a "why" |
| 9 Family Wealth OS | Mostly English | Hebrew answers, data-source labels (demo / imported), 6-month series, charts |
| 12 Automation studio | JSON only | Natural language → workflow, with guardrails ("do not unlock" is recorded and enforced; sensitive steps get approval gates); error branches; presence triggers |
| 13 Voice | Basic | Live mic level ring, barge-in, push-to-talk (Alt+Space and a desktop global shortcut), transcript retention and deletion |
| 14 Sync | None | `/api/sync` change feed, `/api/sync/push` idempotent ops with last-writer-wins conflicts, minimal watch payloads, JS SDK with offline queue and backoff |
| 15 Security | Token only | Device scopes, revocation, rate limiting, domain separation (financial / health / family / work), privacy center, audit of policy changes |
| 16 Developer console | None | Model status, latency, cost estimates, API usage, failed tasks, security events, devices |
| 17 Architecture | — | Kept the working, dependency-light Node architecture instead of a rewrite into NestJS / Next.js / Prisma (spec: "adapt to the existing repository"). See §5 |
| 18 Testing | Unit + API | +17 unit/integration tests and an SDK test file (46 total), plus a browser e2e suite (screens, RTL/LTR, accessibility names, approval flow, phone width) |

## 3. Status by area (both prompts)

| Area | Status |
|---|---|
| JARVIS CORE: intent (he/en), plans, states, permissions, approvals, verification | Built & tested |
| 18 agents, schemas, delegation, step budgets | Built & tested |
| Autonomy levels, bound + expiring approvals | Built & tested |
| Model router + Claude adapter + local engine | Built & tested (Claude adapter not exercised against the live API: no key here) |
| Personality system | Built & tested |
| Memory engine (hybrid, dedupe, domains, expiry, export/delete) | Built & tested |
| Documents (txt/md/csv/json/html) | Built & tested. PDF / DOCX / XLSX / OCR: needs an extraction service (not built) |
| Family Wealth OS API (all specified endpoints), deterministic math, money never moves | Built & tested on demo data. Connecting your real FWOS: needs you |
| Smart home (Home Assistant adapter, demo home, sensitive-action approvals) | Built & tested on the demo home. A real HA instance: needs you |
| Automations: NL builder, conditions, approvals, retries, error branches, schedules, events | Built & tested |
| Notifications: priority, quiet hours, grouping, in-app / SSE / browser, Expo push | Built & tested (Expo delivery needs a built phone app) |
| Proactive engine with explanations | Built & tested |
| Devices, scoped tokens, sync, offline queue, conflicts | Built & tested (server + JS SDK) |
| Health (opt-in, separate, no diagnosis) | Built & tested (server). HealthKit / Health Services readers: source |
| Weather (Open-Meteo) | Built & tested (degrades honestly offline) |
| Web command center (13 screens, RTL/LTR, dark/light, PWA) | Built & tested (e2e) |
| Desktop app (Tauri: tray, global shortcuts, push-to-talk, background) | Built & run (compiled and launched on Linux here). Windows / macOS installers: build on those OSes |
| Desktop bridge (apps, URLs, allowed folders, screenshots) | Built & tested (broker). Bridge process: run on your computer |
| Mobile app (Expo, iOS + Android) | TypeScript-checked and bundled (Android Hermes bundle built here). Store builds: needs you (EAS / Apple developer account) |
| Apple Watch app + complication | Source |
| Wear OS app + tile | Source |
| Prototypes (`prototypes/`): live demo of the real UI on recorded data, plus watch / phone screens | Built & run |
| Docker deployment | Dockerfile + compose written; not run here (no Docker daemon) |
| Passkeys / MFA, multi-user households, OAuth calendar / email | Not built (see §4) |
| Server-side streaming STT/TTS, wake word | Not built. Browser / phone on-device speech is used |
| PostgreSQL + pgvector, Redis | Not built. JSON store behind a small interface (see §5) |

## 4. Remaining limitations, in priority order

1. **Identity.** It is single-owner today: an owner token plus per-device tokens. Passkeys/MFA and multi-member households with roles are the next security step.
2. **Real data sources.** Family Wealth OS, Home Assistant, Google/Microsoft calendar and email need your credentials and OAuth app registration.
3. **Storage at scale.** The JSON file store is fine for one household. Moving to PostgreSQL + pgvector means swapping `server/lib/store.js` and `memory/embed.js` while keeping their interfaces.
4. **Voice quality.** Browser speech recognition is good but not streaming. A server STT/TTS adapter (for example, a realtime speech API) can plug into channel `voice`.
5. **Document extraction.** Supporting PDF, DOCX, XLSX and OCR means adding a converter that feeds `Documents.add`.
6. **Native builds.** The watch apps need Xcode or Android Studio on your machine.

## 5. Architecture decision: no rewrite

The evolution spec suggests Next.js, NestJS, Prisma, PostgreSQL and Redis, and also says to adapt to the existing repository and not to discard working functionality. The existing server was already modular (one folder per domain), dependency-light and fully tested. Rewriting it would have discarded working, tested behaviour for no user-visible gain at single-household scale. The module boundaries map one-to-one to the spec's list:

| Spec module | This repo |
|---|---|
| Identity & access | `server/security`, `server/devices` |
| AI orchestration | `server/core` |
| Agents & tools | `server/agents`, `server/tools` |
| Memory | `server/memory`, `server/documents` |
| Voice | `web/js/voice.js`; server channel `voice` |
| Device sync | `server/devices`, `sdk/` |
| Wearables | `apps/watchos`, `apps/wearos`, `/api/watch` |
| Automation | `server/automation` |
| Financial integration | `server/wealth` |
| Smart home | `server/home` |
| Notifications | `server/notify` |
| Observability | `server/observability` |

Each module can be lifted into its own service later without changing the others.
