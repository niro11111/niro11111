# JARVIS Autonomous Learning & Self-Improvement Engine

JARVIS measures its own performance, finds recurring problems, proposes concrete fixes, tests them in isolated sandboxes against the current version, and deploys a change only after the required approval and validation. Every change is versioned, signed, reversible and audited.

**Code:** `server/learn/`

| File | Responsibility |
|---|---|
| `engine.js` | Learning Orchestrator |
| `classify.js` | Error Analysis |
| `experiments.js` | Development Sandbox + Regression Testing |
| `versions.js` | Prompt/Workflow Version Manager + Rollback Manager |
| `devlab.js` | Capability development workspace |
| `isolate.js` | Isolated execution |
| `sign.js` | Artifact signatures |
| `benchmarks.js` | Model Evaluator |
| `insight.js` | Agent Evaluator, knowledge quality, FWOS validation, Security Monitor |

**Elsewhere:**
- **Screen:** Self-Improvement (`web/js/learnview.js`)
- **API:** `/api/v1/learning`
- **Tests:** `tests/learning.test.js` and the webapp e2e suite

Three processes are kept separate, with separate permissions:

| Process | What changes | Who decides |
|---|---|---|
| Learning about the user | Profile items and scoped preferences | Proposed by JARVIS, approved by the user |
| Operational configuration | Learned phrases, prompt overlay, routing, style, workflows, custom agent instructions | Tested proposal, then owner approval (mode 4 auto-apply only for types the owner listed) |
| Software | New capabilities from the Development Lab | Verified, signed branch, then owner installs |

## 1. Acceptance criteria 1-12

```
signals: failed tasks · negative feedback (rating, text, voice) · rejected approvals
         · failed mission tasks · abandoned clarifications
  → classify into 13 classes + affected component, with logs/tool outputs/verification   AC1
  → recurring when ≥ 3 in 14 days → hypothesis with evidence, or "insufficient evidence" AC2
  → ranked solutions, each with risk / reversibility / approval need
  → proposal: one versionable change                                                    AC3
  → experiment: candidate version in a sandbox brain                                    AC4-5
  → comparison report: per case, per category (multilingual, security), latency,
      violations, false successes                                                       AC6, AC8
  → any regression blocks the proposal                                                  AC7
  → deployment approval request (bound to the candidate hash, expires in 7 days)        AC9
  → owner approval → owner deployment as a new signed version                           AC10
  → post-deployment monitoring → rollback (with a rollback record)                      AC11
  → learning audit for every step + security events for every blocked attempt           AC12
```

**Worked example** (tested in unit tests and in the browser): with no AI model available, the user asks "תמונת מצב כספית" several times and each request fails.

1. JARVIS classifies the failures as `model_selection` (component `model-router`).
2. It finds that 4 of 4 requests match the read-only capability `wealth.overview`.
3. It proposes learned phrases for it.
4. In the sandbox, the proposal goes from 15/19 to 19/19 with no regressions.
5. JARVIS requests approval.
6. After the owner approves and deploys, the request works.
7. A rollback restores v1.

## 2. Failure classes

| Class | Component |
|---|---|
| intent_misinterpretation | intent-parser |
| missing_context | context-engine |
| memory_retrieval | memory |
| model_selection | model-router |
| agent_coordination | agent-orchestrator |
| invalid_parameters | tool-execution |
| permission_denied | policy |
| external_api | external |
| timeout | tool-execution |
| data_inconsistency | data |
| calculation_error | computation |
| verification_failure | verification |
| expectation_mismatch | response |

Anything else is `unclassified` and never gets a named cause.

## 3. Optimization modes

| Mode | Behavior |
|---|---|
| 1 Observe | Monitor and identify; no proposals. |
| **2 Recommend (default)** | Proposals with explanation; tests run when the owner starts them. |
| 3 Experiment | Proposals are tested automatically in the sandbox; deployment still needs approval. |
| 4 Approved deployment | As 3. Only change types the owner explicitly listed (`personality`, `intent_alias`, `preferences`, all low-risk and reversible) may deploy automatically, and only after passing every test. Everything else needs approval. |

## 4. What can never change

**Protected** (refused with 403 and logged as a security event):
- policy, autonomy and permissions
- agent risk limits
- financial rules and budgets
- retention and privacy
- capabilities
- the learning mode
- devices and approvals

**Ownership:** only the owner can change the mode or the auto-apply list, approve, deploy, roll back, or install lab code. No code path inside the engine calls these. Learned phrases may only open read-only capabilities. Prompt overlays and custom-agent instructions are safety-linted, and the fixed safety rules stay last.

**Code changes:** proposals never change code or the engine itself. New code comes only through the Development Lab, as a pure, read-only function.

## 5. Security of self-improvement

- **Isolation:**
  - Experiments run in in-memory sandbox brains with demo data, no model, blocked network and silenced events. Only learnable configuration is copied in, never keys or tokens.
  - Replays of real requests are anonymized (emails and long numbers are masked).
- **Development Lab:**
  - **Static analysis:** rejects module loading, host globals, network, `eval`/`Function`/timers, prototype tricks, storage, `this` and unbounded loops.
  - **Dependency scan:** dependencies are not allowed.
  - **Secret scan.**
  - **Isolated execution:** a Web Worker with network and storage APIs removed, or a Node `vm` context with no `require`/`process` and string code generation disabled. Both have a 1-second timeout.
  - **Verification tests:** build verification, unit tests, hostile-input security tests and performance timing.
- **Signatures:** every config version and lab artifact is signed (nested keyed SHA-256). A tampered version is never restored. Lab code whose signature does not match never installs or runs.
- **Production change monitoring:** the Security Monitor reports live values that differ from the active version (drift), tampered versions, injection attempts and bursts of denials.
- **Limits:** a Node `vm` is defense in depth, not a hard boundary. For untrusted third-party code in production, run the lab in a container. Signatures detect changes made outside the engine, not an attacker who holds the store's key.

## 6. Components

- **Performance:** daily series, snapshots and history.
  - **Filters:** agent, model, capability, mission type, application (channel), device and period.
  - **Measures:** success, latency (avg/p95), verified steps, clarifications, satisfaction, model calls, model errors and cost.
- **Feedback:** ratings, written notes and corrections, voice/text phrases ("זה ארוך מדי", "that was wrong") and rejected approvals.
  - A preference needs ≥2 consistent signals and no conflicting ones.
  - Financial corrections stay scoped to their answer. Financial length feedback becomes a *scoped* preference ("Family Wealth OS reports"), not a global change.
- **Personalization:**
  - 12 categories, including tone, format, language, task organization, notifications, applications, devices, routines and projects.
  - Observed behavior patterns become proposals, never active items.
  - Health, financial and family data are not used. You can inspect, approve, correct, delete, disable a category or export.
- **Model intelligence:**
  - Benchmark suites: math, Hebrew, extraction, planning, data analysis, research, coding, safety. They use automatic graders and synthetic prompts only.
  - Recommendations rank accuracy first; only then latency and cost.
  - Open requests are tagged with a task category, so an approved routing change takes effect.
- **Agent intelligence:**
  - Per-agent score: success, verified steps, latency, satisfaction, denials, repeated identical calls.
  - Overlapping responsibilities and prompt analysis (ambiguity, conflicting rules, missing rules).
  - Mission evaluation. Permissions are never raised.
- **Knowledge freshness:**
  - Stale finance data and demo data, old or expiring memories and old documents.
  - Duplicates, conflicting records (similar statements with different numbers) and incomplete documents.
  - Source links are checked only on request.
  - Verified information is never replaced silently.
- **Suggestions:**
  - Each one states what was detected, why it matters, the recommendation, the expected benefit, the risk and whether approval is needed.
  - You can approve, postpone or dismiss. At most 7 are shown.
  - They include rollback suggestions when a problem recurs after a deployment, and automation suggestions for repeated manual routines.
- **Family Wealth OS:** suggestions only; calculations stay deterministic.
  - Categorization suggestions need ≥2 consistent examples.
  - Possible duplicate imports and possibly missing imports are flagged.
  - Unreliable forecast assumptions (< 6 months of history) are flagged.
- **Regression testing:** runs the full suite on the current production configuration and compares it with the previous run.

## 7. Entities, retention and provenance

| Entity | Collection | Notes |
|---|---|---|
| LearningEvent | `learning_events` | Purged after 180 days |
| UserFeedback | `feedback` | Rating, category (chosen or inferred), note, correction, source (rating/voice/conversation), channel, lang, tools, agents |
| PreferenceProposal | `profile_items` | Source, confidence, observedAt, scope, expiresAt (expired automatically), evidence |
| PreferenceVersion | `config_versions` (`personality`, `preferences.scoped`) | |
| PerformanceMetric | `perf_snapshots` | Daily |
| MissionEvaluation | computed (`GET missions`) | |
| ModelBenchmark | `model_benchmarks` | Suites and live snapshots |
| AgentEvaluation | `agent_evaluations` | |
| PromptVersion / WorkflowVersion | `config_versions` | `prompt.system_overlay`, `agent:<handle>`, `workflow:<id>`, `intent.aliases`, `routing.preferences`. Each has versionId, description (reason), author (createdBy), evaluation, approval, rollbackRef, digest and signature |
| ImprovementProposal | `improvement_proposals` | |
| Experiment / ExperimentResult | `experiments` | `report.rows`, categories, metrics. Case rows are purged after 90 days; summaries are kept |
| DevelopmentBranch | `development_branches` | |
| SecurityScan | `security_scans` | |
| DeploymentApproval | `deployment_approvals` | candidateHash, expiresAt |
| DeploymentRecord | `deployments` | |
| RollbackRecord | `rollback_records` | |
| KnowledgeFreshnessCheck | `freshness_checks` | |
| LearningAuditEvent | `learning_audit` | Kept; also mirrored in `audit` |
| Security events | `learning_security` | |

Ownership: a single-owner install. Every record has timestamps, and actions record their actor.

## 8. API (`/api/v1/learning`, owner token; device tokens are refused)

| Area | Endpoints |
|---|---|
| Overview | `GET dashboard`, `GET/PUT mode`, `PUT auto-apply`, `POST cycle`, `GET history`, `GET audit` |
| Performance | `GET performance?days&agent&model&tool&kind&channel&device&from&to`, `POST performance/snapshot` |
| Error analysis | `GET signals`, `POST analyze`, `GET patterns`, `POST patterns/:id/dismiss`, `GET logs/:taskId` |
| Feedback and profile | `POST/GET feedback`, `GET profile`, `GET profile/export`, `PUT profile/categories/:id`, `POST profile/items/:id/approve`, `PATCH/DELETE profile/items/:id` |
| Proposals | `GET/POST proposals`, `GET proposals/:id`, `POST proposals/:id/experiment`, `.../request-approval`, `.../approve` (`{deploy:true}` for both steps), `.../deploy`, `.../reject` |
| Experiments and regression | `GET experiments`, `GET experiments/:id`, `POST/GET regression` |
| Deployments and approvals | `GET approvals`, `GET deployments`, `POST deployments/:id/rollback`, `GET rollbacks` |
| Versions | `GET versions`, `GET versions/:target`, `GET versions/:target/compare?a&b`, `POST versions/:target/rollback` |
| Models | `GET models`, `GET models/intelligence`, `POST models/evaluate`, `POST models/benchmark`, `POST models/propose-routing` |
| Agents and missions | `GET agents`, `GET agents/intelligence`, `POST agents/evaluate`, `GET missions`, `GET prompts` |
| Knowledge, R&D and FWOS | `GET knowledge`, `POST knowledge/check-links`, `GET freshness`, `GET research`, `GET fwos/categorization`, `POST fwos/categorization/:id/apply`, `GET fwos/validation` |
| Development Lab | `GET lab`, `POST lab/branches`, `GET/PATCH lab/branches/:id`, `POST lab/branches/:id/(generate\|verify\|install\|uninstall)`, `GET lab/scans` |
| Suggestions and security | `GET suggestions`, `POST suggestions/:id/(approve\|postpone\|dismiss)`, `GET security` |

The scheduler runs one bounded cycle per hour: a snapshot, an analysis, observed patterns, at most one experiment (in mode 3 or higher) and retention.

## 9. Known limits

- The sandbox has no AI model by design. A prompt overlay's effect on live answers is measured after deployment, through feedback.
- Model benchmarks need a configured model: an API key, or Claude inside claude.ai.
- "Experimental branches" are versioned workspaces in the JARVIS store, not git branches. Real source changes to JARVIS itself go through the repository and CI.
- Lab code generation needs a model. Without one, code can be pasted and still goes through every check.
- The spec's NestJS/PostgreSQL/Redis stack is not used. The modular Node services and JSON store are kept, as in the rest of JARVIS.
