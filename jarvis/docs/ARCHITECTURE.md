# JARVIS Architecture

## 1. Overview

```
 Web (built) ─┐  Desktop/Tauri (planned) ─┐  Mobile/Expo (planned) ─┐  Voice (built, browser)
              └──────────────── REST + SSE (/api, /api/stream) ───────┘
                                     │
                              JARVIS CORE (orchestrator)
       intent → context(memory) → plan → permissions → approval → execute → verify → respond
                                     │
       ┌──────────── agents (allow-listed tools, step limits) ────────────┐
       │ executive research computer finance home coding communication    │
       │ knowledge security planning vision automation                    │
       └───────────────────────────────┬──────────────────────────────────┘
                                 tool registry (risk + verify)
     memory · wealth · home · productivity · documents · research · notify · desktop bridge
                                     │
                     ModelRouter → provider adapters (anthropic, local)
```

Agents never call each other. JARVIS CORE builds the plan, and each step names one agent and one tool. A step is rejected if the tool is not on that agent's allow-list, or if the agent goes over its step limit.

## 2. Task lifecycle

Execution states: `PENDING → PLANNING → (AWAITING_APPROVAL) → EXECUTING → VERIFYING → COMPLETED | FAILED | CANCELLED`. `server/core/states.js` enforces the legal transitions and records each one in `task.history`.

Every plan includes the objective, retrieved memory context, agents, tools, steps, dependencies, a permission decision for each step, success criteria, the verification method, and a recovery policy.

- **Verification.** A tool can define `verify()`, which re-reads real state: the device state from the hub, or the record in the store. A task reaches `COMPLETED` only after every step passes verification.
- **Recovery.** Execution stops at the first failure. The response lists exactly which steps did complete. Steps that are `external`, `sensitive` or `financial` are never retried automatically.
- **No fake success.** If an open question has no language model configured, the task is `FAILED` and the response explains why.

## 3. Model routing

`ModelRouter.route({complexity, latency, vision, privacy, webSearch})` returns one of the tiers `fast`, `balanced`, `deep` or `local`, together with the reason for the choice.

- **Privacy.** `local_only` always routes to the local provider.
- **Fallback.** If no provider is configured, the router falls back to `local` and marks the route `degraded`.
- **Providers.** Each provider is an adapter (`providers/*.js`) with `complete()` and `capabilities()`. Adding OpenAI, a local Llama, or anything else means adding one adapter; the core does not change.
- **Claude adapter.** It uses the official SDK, adaptive thinking with `effort` set per tier, server-side refusal fallback on Opus/Sonnet, and the web search server tool for research.

## 4. Security model

| Risk | Examples | Default | Can be set to `allow`? |
|---|---|---|---|
| read | briefing, wealth analysis, memory search | allow | yes |
| write | tasks, reminders, memory | allow | yes |
| external | lights, scenes, web fetch, open app | allow | yes |
| sensitive | unlock door, disarm alarm, read file, screenshot | approve | **no** |
| financial | transfer, invest, purchase, cancel product | approve | **no**, and never executed |

- **Device risk.** Risk is computed from the arguments. `home.control` is `external` for lights and `sensitive` for `lock.unlock`.
- **Audit.** The audit log records every tool call, approval, denial and blocked financial action.
- **Untrusted content.** Web pages and documents are wrapped in `<untrusted_content>` and scanned for injection patterns (Hebrew and English). The model is told not to follow instructions found inside them. URLs pointing at private networks are blocked (SSRF guard).
- **API access.** The API needs a bearer token, compared in constant time. It binds to `127.0.0.1` by default. The static file server rejects path traversal.
- **Desktop bridge.** The bridge enforces its own allow-list of folders (checked after `realpath`) and apps. The server can ask, but it cannot widen what the bridge permits.

## 5. Memory

- **Record fields.** Each memory has a `type` (10 kinds), a `provenance` (`verified | user_statement | inferred | ai_suggestion | outdated`), a `workspace`, `tags`, and an optional `expiresAt`.
- **Trust rules.** A memory written by an AI is downgraded to `ai_suggestion` even if it claims `verified`. Only the user can mark a memory verified, and outdated memories are left out of search.
- **Search.** Semantic search uses a local hashed embedding: words, character trigrams and Hebrew prefix stripping. The `embed()` interface is ready to be swapped for PostgreSQL + pgvector with provider embeddings.
- **User control.** Users can inspect, search, correct, export (JSON) and delete memories, and review memories JARVIS added.

## 6. Family Wealth OS

- **Money handling.** All amounts are integer minor units (agorot), and every calculation lives in `wealth/calc.js`. That covers the month summary, comparison, budgets, anomalies, duplicates, recurring charges, net worth, forecast, goals and scenario simulation. No LLM does the arithmetic.
- **Output structure.** `analysis()` returns `facts`, `calculations`, `forecasts` and `recommendations` as separate fields, plus a disclaimer.
- **Household isolation.** Every query is scoped by `householdId`, and a call without a household is rejected.
- **Endpoints.** These are implemented as specified:
  - `GET /api/wealth/{overview,accounts,transactions,budgets,goals,assets,liabilities,insights,reports}`
  - `POST /api/wealth/{analysis,recommendations}`
  - `POST /api/wealth/import`, which emits `wealth.transaction_imported` for automations.
- **Money movement.** Moving money goes only through `guardAction`, which logs the request and returns "not executed".

## 7. Voice

The web client uses the browser's Web Speech API for speech-to-text (`he-IL` / `en-US`) and speech synthesis.

- **Language.** The reply voice follows the language of the response.
- **Controls.** Users can pick the voice and speed. Alt+Space is push-to-talk, and Esc stops everything.
- **Conversation.** Conversation mode keeps taking turns. Users can interrupt JARVIS mid-reply (barge-in) if they enable it.
- **Microphone.** The microphone starts only on a user action, and a red **MIC ON** indicator shows the whole time it is live.
- **Voice routing.** Voice requests go to the `fast` tier for latency.
- **Planned.** A server-side STT/TTS adapter (streaming, wake word where supported and explicitly enabled) can plug into the same `/api/command` channel `voice`.

## 8. Built vs planned

The current, section-by-section status of both specs (master and evolution) is in [`EVOLUTION.md`](EVOLUTION.md). The owner's setup steps are in [`SETUP_GUIDE.he.md`](SETUP_GUIDE.he.md).
