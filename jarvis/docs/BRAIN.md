# JARVIS BRAIN: architecture, audit and roadmap

The central intelligence layer of JARVIS. It is not one big prompt. It combines deterministic software (intent parsing, permissions, math, missions, verification) with language models used through a provider-independent gateway, and only where a model adds value.

Self-improvement engine: [`LEARNING.md`](LEARNING.md).

Live status of every capability: [`BRAIN_COVERAGE.md`](BRAIN_COVERAGE.md). Regenerate it with `npm run brain:report`. It is also available in the app (Brain Center → Coverage) and at `GET /api/v1/brain/coverage`.

## 1. Phase 1 audit (what existed before this phase)

| Area | Before | Added in this phase |
|---|---|---|
| Orchestrator | Pipeline with states, plans, approvals, verification | Request analysis, clarification and resume, typed events, failure analysis, agent risk ceilings, timeouts |
| Intent | Hebrew/English rules with a model fallback | Structured analysis: kind, language (he/en/mixed), entities, dates, amounts, urgency, risk, missing information, strategy, confidence estimate |
| Missions | Sequential "plan & execute" | DAG engine: parallel tasks, dependencies, approvals, pause/resume/cancel, timeouts, safe retries, idempotency, partial completion, recovery |
| Models | Routing by complexity and privacy | Fallback chain, circuit breaker, rate-limit retry, per-task preferences, health |
| Capabilities | Tool registry | Capability descriptions, semantic search, health, a controlled extension mechanism |
| Evaluation | Developer tests only | A regression suite inside JARVIS, on an isolated sandbox |

## 2. Components

Every component has one responsibility and a typed interface. Errors are thrown as `Error` with an optional HTTP `status`.

| # | Component | Module | Input → output | Error behavior | Tests |
|---|---|---|---|---|---|
| 1 | Central Orchestrator | `server/core/orchestrator.js` (`Core.handle`, `plan`, `run`, `decide`) | message + {conversationId, actor, channel} → task {state, analysis, plan, response, outputs, failure} | Never reports success without verification; a failure carries a classified analysis and a recommendation | `core`, `brain2`, eval |
| 2 | Intent Understanding | `server/core/intent.js`, `server/brain/analyze.js` | text → steps; steps → analysis {kind, lang, entities, urgency, risk, missing, complexity, strategy, confidence} | Missing details produce a question (`AWAITING_INPUT`), never a guess | `brain2` |
| 3 | Context Engine | `server/brain/context.js` | query → ranked items {source, provenance, updatedAt, fresh, ref} | Financial and health data are excluded from general context | `brain` |
| 4 | Reasoning & strategy | `analyze.js` STRATEGY, `ai/engines.js` (deepThink, council, decide), `wealth/calc.js`, `tools/utility.js` | analysis → strategy; exact math is never left to a model | Model output is parsed and validated (JSON) | `engines`, `brain`, `capabilities` |
| 5 | Model Gateway | `server/core/router.js` | need {complexity, latency, privacy, vision, task} → route; `complete()` with fallback | Rate limit: one retry; failure: next tier; 3 failures: provider rests for 2 minutes | `brain2`, `core` |
| 6 | Agent Orchestrator | `server/agents/registry.js` + Core | agent contract {tools, dataScopes, timeoutMs, retry, riskLimit, I/O schema} | An agent can never act above its risk ceiling or use a tool outside its list | `brain2`, eval `risk-ceiling` |
| 7 | Capability Registry | `server/brain/capabilities.js` | tools → capabilities {id, domain, schemas, risk, deps, adapter, verification, version, availability, health}; `search(q)` | Extensions: 6 checks, then owner approval; unknown tools never run | `brain2` |
| 8 | Tool Execution | `Core.run`, `Core.runFromModel` | {tool, args, ctx, agent} → {executed, verified, summary} or {awaitingApproval} | Validation, policy, agent check, timeout, evidence record, verification, idempotency key | `brain2`, eval |
| 9 | Memory & Knowledge | `memory/*`, `documents/*`, `episodes`, `missions` (working memory) | hybrid search with provenance and confidence | AI-written memories are never "verified" | `evolution`, `brain` |
| 10 | Multimodal | `server/brain/multimodal.js` | {kind: text, image, document, data, audio, video} → structured output with a source reference | Unsupported formats return an explicit "not supported" | `brain2` |
| 11 | Permission & Policy | `security/policy.js`, `Core.decide` | risk + autonomy + agent → allow / approve / deny / advise | Approvals are action-hash bound and expire after 15 minutes | `core`, `evolution`, eval |
| 12 | Mission Execution | `server/brain/missions.js` | goal or spec → mission {tasks DAG, status, verification, log} | Blocked prerequisite: dependents are blocked; denied: rejected; writes are never retried | `brain2`, `engines`, eval |
| 13 | Verification | tool `verify()`, mission verification status | execution → verified / unverifiable / failed | Verification failure means a failed task | all |
| 14 | Learning & Feedback | `server/brain/learning.js` | messages and feedback → review queue, adaptation suggestions | Never changes permissions or security; the user applies suggestions | `brain` |
| 15 | Observability & Evaluation | `observability/metrics.js`, `brain/events.js`, `brain/failures.js`, `brain/evaluation.js`, `brain/coverage.js` | events (contract v1), failures, evaluation runs, coverage | The evaluation sandbox is isolated and cannot change policy | `brain2` |

## 3. Request lifecycle

```
message ─► pending clarification? ──yes──► fill the field ─► resume the same task
            │no
            ▼
intent parse (deterministic, Hebrew/English) ─► resolve devices ─► analyzeRequest
            │ missing details ─► AWAITING_INPUT (one question)
            ▼
context (domain-filtered) ─► steps: schema validation, risk, policy, agent ceiling ─► plan {kind, strategy, confidence}
            │ deny ─► FAILED + reason          │ approve ─► AWAITING_APPROVAL (action-bound, 15 min)
            ▼
execute (timeout, events, evidence) ─► VERIFYING (re-read real state) ─► COMPLETED / FAILED + failure analysis
            ▼
learning (preferences to review) · episodic record · metrics
```

## 4. Entity map (JSON store collections)

| Spec entity | Collection / source |
|---|---|
| AIModelProvider, AIModel, ModelUsage | `router.tiers`, `router.gateway()`, `metrics.calls` |
| Agent, AgentCapability | `agents/registry.js` (built-in), `custom_agents` |
| Capability, Tool, ToolPermission | `tools` registry, `capability_registrations`, policy |
| UserMemory, MemorySource, KnowledgeDocument | `memories` (provenance, source, domain), `documents` |
| KnowledgeEntity, KnowledgeRelationship | partial: typed memories (`person`, `project`); no relationship graph yet |
| ConversationContext | in-memory conversations, `voice_transcripts`, `conversation_summary` memories |
| Mission, MissionTask, MissionDependency | `missions` (tasks with `dependsOn`) |
| AgentExecution, ToolExecution, ExecutionEvidence | `tasks_exec`, `tool_executions` (idempotencyKey, risk, decision, verified) |
| ApprovalRequest | `approvals` (actionHash, expiresAt, consequences) |
| EvaluationRun | `evaluations` |
| UserPreference | `_meta.personality`, `_meta.modelPrefs`, `preference` memories |
| SecurityAuditEvent | `audit` |

Household isolation is applied to every finance query by `householdId`. Multi-user households are planned.

## 5. API v1 and events

Base: `/api/v1/brain`.

| Area | Endpoints |
|---|---|
| Requests | `POST requests`, `GET requests/:id` |
| Missions | `POST missions` (goal or explicit task spec), `GET missions`, `GET missions/:id`, `POST missions/:id/pause`, `POST missions/:id/resume`, `POST missions/:id/cancel` |
| Approvals | `POST approvals/:id/approve`, `POST approvals/:id/reject` |
| Capabilities | `GET capabilities[?q=]`, `POST capabilities` (register), `POST capabilities/registrations/:id/approve`, `DELETE capabilities/:id` |
| Agents and memory | `POST agents`, `GET agents`, `GET memory[?q=]`, `PATCH memory/:id` |
| Executions and evidence | `GET executions`, `GET evidence/:taskId` |
| Evaluation and reports | `POST evaluations`, `GET evaluations`, `GET coverage`, `GET failures`, `GET events` |
| Gateway and analysis | `GET gateway`, `PUT gateway/preferences`, `POST analyze` |

Event contract v1 (`GET events` returns the schema): `request.received`, `mission.created`, `task.assigned`, `agent.started`, `tool.invoked`, `approval.required`, `tool.completed`, `verification.completed`, `mission.completed`, `mission.failed`. Each event has `{type, v, at, ...required fields}`.

## 6. Evaluation suite

`brain/evaluation.js` runs 15 cases in 11 categories on an isolated, in-memory sandbox brain with no model:

- simple and multilingual requests (Hebrew and mixed)
- ambiguous requests answered by a three-turn clarification
- missing data, and a tool failure (an offline device)
- malicious content: an injected unlock and a fake "admin mode" transfer
- permission denial (policy and agent ceiling) and sensitive operations (advisory mode, approval binding)
- interrupted missions, recovered without double execution
- duplicate sync events, and exact precision

It measures pass rate, latency, permission violations and false successes. Run it from the Brain Center or with `POST /api/v1/brain/evaluations`. Current result: 15/15, 0 violations, 0 false successes.

## 7. Roadmap (next phases)

Done since: the Autonomous Learning & Self-Improvement Engine ([`LEARNING.md`](LEARNING.md)).

1. **Knowledge graph:** entity extraction and relationships across memories, notes and missions.
2. **Multi-user households:** per-member context isolation and family roles.
3. **Server STT/TTS and document extraction:** PDF, DOCX, XLSX and OCR adapters plugged into `multimodal.js`.
4. **Code-assisted computation:** a sandboxed code-execution capability, registered through the extension mechanism.
5. **Labelled answer set:** measure live model accuracy and hallucination, beyond the deterministic suite.
6. **PostgreSQL + pgvector backend:** behind the same Store and Memory interfaces, with load tests.
