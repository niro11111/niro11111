# JARVIS BRAIN: capability coverage

Generated 2026-11-05 by `npm run brain:report`.

- **Implemented and tested**: 62
- **Implemented but not fully tested**: 1
- **Partially implemented**: 4
- **Planned**: 3
- **Blocked by external dependency**: 5
- **Unsupported**: 1

| Section | Capability | Status | Evidence |
|---|---|---|---|
| §3 Orchestrator | Request lifecycle: language → intent → context → plan → permissions → execute → verify → respond | Implemented and tested | core/orchestrator.js · tests/core, brain2 |
| §3 Orchestrator | Clarification questions for missing details, then resume the same task | Implemented and tested | brain/analyze.js CLARIFY · tests/brain2 · eval clarify-reminder |
| §3 Orchestrator | Simple requests skip planning overhead (deterministic path, no model) | Implemented and tested | core/intent.js · chat.smalltalk |
| §4 Intent | Kind, entities, dates, amounts, urgency, risk, missing info, confidence estimate (he/en/mixed) | Implemented and tested | brain/analyze.js · tests/brain2 |
| §4 Intent | Model-based intent extraction for open requests | Implemented but not fully tested | llm.answer with tools (live model not available in CI) |
| §5 Context | Relevance-scored retrieval across memory, notes, documents, tasks, calendar, habits, episodes, with provenance and freshness | Implemented and tested | brain/context.js · tests/brain |
| §5 Context | Domain filtering (financial/health kept out of general context) | Implemented and tested | memory domains · tests/brain |
| §5 Context | Separation between family members (multi-user households) | Planned | single-owner install today |
| §6 Reasoning | Strategy selection (direct, retrieval, computation, comparative, scenario, multi-agent, decomposition, iterative verification, tool-assisted) | Implemented and tested | brain/analyze.js STRATEGY |
| §6 Reasoning | Deterministic computation for money, dates, units, statistics | Implemented and tested | wealth/calc.js, tools/utility.js · eval exact-math |
| §6 Reasoning | Iterative verification (draft → critique → revision) | Implemented and tested | ai/engines.js deepThink · tests/brain |
| §6 Reasoning | Code-assisted computation (sandboxed code execution) | Implemented and tested | tool compute.code: static analysis + isolated worker/vm with timeout · tests/ml |
| §7 Models | Provider-independent gateway, tiers by complexity/latency/privacy, user preferences | Implemented and tested | core/router.js |
| §7 Models | Fallback chain, provider health with circuit breaker, rate-limit retry, usage and cost tracking | Implemented and tested | core/router.js · observability · tests/brain2 |
| §7 Models | Speech-to-text / text-to-speech providers on the server | Blocked by external dependency | browser and phone speech used; server STT/TTS needs a provider key |
| §7 Models | Image generation, video, embeddings provider | Planned | local embeddings used today |
| §8 Agents | 18 agents with purpose, tools, data scope, I/O contract, timeout, retry policy, risk ceiling | Implemented and tested | agents/registry.js · eval risk-ceiling |
| §8 Agents | Agents cannot grant permissions to themselves or others | Implemented and tested | policy + riskLimit + mission validatePlan |
| §8 Agents | Parallel subtasks, dependencies, combined results | Implemented and tested | brain/missions.js · tests/brain2 |
| §8 Agents | Conflict detection between agents (council disagreements, decision robustness) | Partially implemented | ai.council synthesis, decision sensitivity |
| §9 Missions | DAG missions: success criteria, constraints, agents, risk, statuses, verification status | Implemented and tested | brain/missions.js |
| §9 Missions | Approval checkpoints, pause/resume, cancel, timeouts, safe retries, partial completion, recovery after restart | Implemented and tested | brain/missions.js · tests/brain2 · eval mission-interrupted |
| §9 Missions | Never continue past a failed or denied prerequisite | Implemented and tested | missions.ready() → blocked |
| §10 Capabilities | Registry with id, domain, schemas, permissions, dependencies, adapter, verification, version, availability, health | Implemented and tested | brain/capabilities.js |
| §10 Capabilities | Semantic capability search | Implemented and tested | capabilities.search |
| §10 Capabilities | Controlled extensions: 6 checks + owner approval; unknown tools never run | Implemented and tested | capabilities.register/approve · tests/brain2 |
| §11 Tools | Validate, authorize (user + agent), classify risk, execute with timeout, record evidence, verify | Implemented and tested | Core.run / runFromModel |
| §11 Tools | Idempotency keys; no repeat of consequential operations | Implemented and tested | runFromModel idempotencyKey · eval mission-interrupted |
| §11 Tools | Browser automation / computer control | Partially implemented | desktop bridge (apps, URLs, files, screenshots); no DOM automation |
| §12 Memory | Short-term, working (mission state), long-term, episodic, procedural (workflows), knowledge (documents) | Implemented and tested | memory, missions, episodes, automations, documents |
| §12 Memory | Hybrid search, dedupe, provenance, confidence, expiry, correction, export, deletion | Implemented and tested | memory/memory.js |
| §12 Memory | Semantic memory: entities and relationships (knowledge graph) | Implemented and tested | knowledge/graph.js: he/en extraction, PageRank, paths, provenance · tests/ml · e2e |
| §13 Personalization | Learn preferences (review queue), feedback adaptation, inspect and correct | Implemented and tested | brain/learning.js |
| §13 Personalization | Never change permissions, financial rules or security silently | Implemented and tested | learning only touches personality, on user click |
| §14 Multimodal | Text, voice (browser/phone), images (vision), documents (text formats), structured data (CSV stats) | Implemented and tested | /api/input · brain/multimodal.js |
| §14 Multimodal | PDF/DOCX/XLSX, OCR, audio files, video, camera | Blocked by external dependency | needs extraction/transcription services |
| §15 Accuracy | Internal sources with record ids and timestamps; research citations with retrieval date | Implemented and tested | brain/context.js withSources · research.web |
| §15 Accuracy | Claim-level fact checking across conflicting external sources | Planned |  |
| §16 Failures | Classify transient/permanent/policy/input/external, retry only when safe, alternatives, record | Implemented and tested | brain/failures.js · eval device-offline, missing-record |
| §17 Evaluation | Built-in regression suite (15 cases, 11 categories) on a sandbox brain; metrics incl. permission violations and false success | Implemented and tested | brain/evaluation.js · tests/brain2 |
| §17 Evaluation | Live accuracy / hallucination rate on real model answers | Partially implemented | user feedback + false-success metric; no labelled answer set |
| §18 Safety | Autonomy levels 1–4 (default 3), action-specific, time-limited, parameter-bound approvals | Implemented and tested | security/policy.js, Core.decide |
| §19 Finance | Finance adapter: budgets, cash flow, categories, goals, scenarios, Monte Carlo, reports; never transacts | Implemented and tested | wealth/* |
| §19 Finance | Connection to the real Family Wealth OS | Blocked by external dependency | needs the FWOS API or export |
| §20 Devices | Device registry, scoped tokens, sync, device-adapted responses (watch = short) | Implemented and tested | devices/*, personality |
| §20 Devices | Native watch apps | Blocked by external dependency | source in apps/; needs Xcode / Android SDK to build |
| §21 Conversation | Follow-ups, pronouns, corrections, clarifications, language switching, honest small talk | Implemented and tested | intent.js, analyze.js |
| §22 Proactive | Event-driven suggestions, watchers, quiet hours, priorities | Implemented and tested | proactive/engine.js, brain/watchers.js, notify |
| §23 Stack | Dedicated database: SQLite with migrations, typed views, WAL, backups, integrity checks, read-only SQL console | Implemented and tested | db/sqlite.js · tests/ml |
| §23 Stack | NestJS / PostgreSQL / Prisma / Redis / queues | Unsupported | modular Node services + SQLite (no external database server needed) |
| §24 Entities | Typed collections for providers, agents, capabilities, memory, missions, executions, approvals, evidence, evaluations, usage, audit | Implemented and tested | see docs/BRAIN.md entity map |
| §25 API & events | Versioned API /api/v1/brain and typed event contracts v1 | Implemented and tested | api/routes.js · brain/events.js · tests/brain2 |
| §26 Security | Prompt-injection, permission, duplicate, tool-isolation tests | Implemented and tested | tests/*, eval suite |
| §26 Security | Load tests | Implemented and tested | scripts/load-test.mjs (npm run load:test): ~2,000 req/s, p95 ≈ 18 ms in-memory |
| §ML | Neural network library (MLP, Adam, dropout, early stopping) and Hebrew/English hashed text features | Implemented and tested | ml/nn.js, ml/features.js · tests/ml (XOR gradient check) |
| §ML | Neural intent router: on-device training, held-out metrics, calibration, routing precision; activated only via sandbox experiment + approval | Implemented and tested | ml/intent-model.js, ml.routing target · tests/ml · e2e |
| §ML | Naive Bayes categorization (suggestions only), Holt forecasts with intervals, MAD anomalies, k-means++ clustering | Implemented and tested | ml/algorithms.js, ml/service.js · tests/ml |
| §ML | Signed model registry with champion/challenger promotion | Implemented and tested | ml/service.js · tests/ml |
| §L Learning | Performance monitoring with daily history and filters (channel, agent, tool, dates) | Implemented and tested | learn/engine.js performance/snapshot · tests/learning |
| §L Learning | Error analysis: the spec's 13 failure classes mapped to components, logs and evidence, ranked solutions with risk, "insufficient evidence" when unsupported | Implemented and tested | learn/classify.js, engine.hypothesis · tests/learning AC1-2 |
| §L Learning | Development Lab: isolated branches, static analysis, dependency and secret scans, signed artifacts, unit/security/performance tests, owner-approved install | Implemented and tested | learn/devlab.js, isolate.js, sign.js · tests/learning · e2e |
| §L Learning | Signed config versions, tamper detection, drift monitoring, version comparison, rollback records | Implemented and tested | learn/versions.js · tests/learning |
| §L Learning | Hash-bound, expiring deployment approvals separate from deployment | Implemented and tested | engine.requestApproval/approve/deploy · tests/learning |
| §L Learning | Voice and conversational feedback, scoped financial preferences, observed preference patterns, automation suggestions | Implemented and tested | intent learning.feedback, engine.onFeedback · tests/learning |
| §L Learning | Git-based experimental branches and container isolation for the lab | Partially implemented | branches are store workspaces; worker/vm isolation; containers need server infrastructure |
| §L Learning | Improvement proposals → isolated sandbox experiments → baseline vs candidate comparison with regression detection | Implemented and tested | learn/experiments.js · tests/learning AC3-7 |
| §L Learning | Approval-gated deployment, versioned prompts/aliases/routing/style/workflows, rollback, learning audit | Implemented and tested | learn/versions.js · tests/learning AC8-12 |
| §L Learning | Optimization modes per spec (observe, recommend [default], experiment, approved deployment); owner-listed auto-apply types only; protected areas | Implemented and tested | learn/engine.js MODES, versions.js PROTECTED · tests/learning |
| §L Learning | Structured feedback → preference proposals (source, confidence, observedAt, scope, expiry); never from one example | Implemented and tested | brain/learning.js, engine.onFeedback · tests/learning |
| §L Learning | Personalization profile: inspect, correct, delete, disable categories, export | Implemented and tested | engine.profile · tests/learning |
| §L Learning | Model benchmark suites (math, Hebrew, extraction, planning, data, research, coding, safety) with automatic graders; accuracy-first routing proposals | Implemented and tested | learn/benchmarks.js · tests/learning (fake provider) |
| §L Learning | Agent intelligence: scores, overlaps, unnecessary work, prompt ambiguity/conflicts, mission evaluation | Implemented and tested | learn/insight.js · tests/learning |
| §L Learning | Benchmarks against live models in CI | Blocked by external dependency | needs a test API key; runs on demand in the app |
| §L Learning | Capability R&D (unmet requests, roadmap), knowledge freshness, proactive suggestions (approve/postpone/dismiss) | Implemented and tested | engine.research/freshness/suggestions · tests/learning |
| §L Learning | Family Wealth OS: categorization suggestions only, 2+ consistent examples, applied after approval | Implemented and tested | engine.fwosCategorization · tests/learning |
| §L Learning | Self-improvement dashboard: Intelligence Overview, Model, Agent, Learning Center, Development Lab, Improvement History, Security Monitor | Implemented and tested | web/js/learnview.js · e2e webapp |
