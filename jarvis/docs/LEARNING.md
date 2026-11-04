# JARVIS Autonomous Learning & Self-Improvement Engine

JARVIS watches its own performance, finds recurring failures, proposes concrete fixes, tests them in an isolated sandbox against the current version, and deploys a fix only when it is authorized. Every deployment can be rolled back and every step is recorded.

Code: `server/learn/` (`engine.js`, `classify.js`, `experiments.js`, `versions.js`). Screen: **Self-Improvement** (`web/js/learnview.js`). API: `/api/v1/learning`. Tests: `tests/learning.test.js` and the webapp e2e suite.

## 1. Audit before this phase

| Existed | Gap closed here |
|---|---|
| `failures` collection with 5 coarse kinds | 13 failure classes, recurring patterns, evidence, root-cause hypotheses |
| Thumbs up/down with a note | Structured categories, preference proposals with source, confidence, scope and expiry |
| Brain evaluation suite (15 cases, sandbox) | Baseline vs candidate experiments, targeted replays, regression reports |
| Router preferences, personality settings | Versioned targets with preserved baselines and rollback |
| In-memory metrics | Daily snapshots, history, filters, per-task model benchmarks, agent evaluation |

## 2. Pipeline (acceptance criteria 1-12)

```
signals: failed tasks · negative feedback · abandoned clarifications
  → classify (13 classes, each with the rule it relied on)          AC1
  → cluster by signature → recurring when ≥ 3 in 14 days
  → hypothesis: "likely" with evidence, or "insufficient evidence"  AC2
  → proposal: one concrete, versionable change                       AC3
  → experiment: candidate version in a sandbox brain                 AC4-5
      baseline sandbox (production config) vs candidate sandbox
      full regression suite + replays of the real failed requests
  → comparison report: per-case changes, pass rate, latency,
      permission violations, false successes                         AC6-8
  → regressions or failed checks block the proposal                  AC7
  → owner approval (mode 2) → deployment as a new version            AC9-10
  → post-deployment monitoring (occurrences since deploy)
  → rollback to any earlier version                                   AC11
  → learning audit for every step                                    AC12
```

Worked example, tested in `tests/learning.test.js` and in the browser: the user asks "תמונת מצב כספית" several times with no AI model. Each request falls through to `llm.answer` and fails. The engine:

1. Classifies the failures as `model_unavailable`.
2. Finds that 4 of 4 requests match the read-only capability `wealth.overview`.
3. Proposes learned phrases for it.
4. Tests the proposal in the sandbox: 15/19 → 19/19, with no regressions.
5. After the owner approves, deploys the phrases as `intent.aliases` v2, so the request now succeeds.
6. A rollback restores v1.

## 3. The 13 failure classes

| | | | |
|---|---|---|---|
| intent_misunderstood | missing_information | wrong_tool | tool_error |
| external_unavailable | permission_denied | model_unavailable | incorrect_answer |
| timeout | rate_limited | data_not_found | verification_failed |
| user_dissatisfied | | | |

Rules classified with a firm signal count fully toward confidence; weak heuristics count less. Confidence is labelled as an estimate.

## 4. What can change, and what never can

The engine can propose changes to these versioned targets:

| Target | Constraint |
|---|---|
| `intent.aliases` | Learned phrases only for **read-only** capabilities, with no arguments. Applied only where the deterministic parser had no rule. |
| `prompt.system_overlay` | Safety-linted: no "ignore", "without approval", "unlock", "transfer" and similar. Placed before the safety rules, which stay last and unchanged. |
| `routing.preferences` | Must name a known model tier. Local-only privacy still forces the local engine. |
| `personality` | Only verbosity, style, language and humor. |
| `workflow:<id>` | Re-validated by the automation engine. |

**Protected (refused with HTTP 403, with or without approval):** policy, autonomy, permissions, agent risk ceilings, financial rules, budgets, retention, privacy, capabilities, the learning mode, devices and approvals. The engine cannot change its own mode. No code path inside it calls `setMode`, and the API accepts it only from the owner. Proposals change configuration values, never code, and never the engine itself.

## 5. Optimization modes

| Mode | Behavior |
|---|---|
| 1 Observe | Metrics, patterns and reports only. |
| **2 Propose & test (default)** | Proposals are created and tested in the sandbox automatically. Every deployment needs the owner's approval. |
| 3 Auto-apply personalization | As mode 2, and style/length changes that pass testing are applied automatically, with a notification and rollback. |
| 4 Supervised autonomy | As mode 3, and read-only learned phrases that pass with zero regressions are applied automatically. Prompts, routing and workflows still need approval. |

## 6. Other components

- **Feedback learning:** a negative rating gets a category, either chosen or inferred from the note. A preference proposal needs **at least 2 consistent signals** and no conflicting ones. Each proposal records `source`, `confidence`, `observedAt`, `scope` and `expiresAt`.
- **Personalization profile:** six categories. You can inspect, approve, correct, delete, disable a category, or export (`jarvis-profile-v1`).
- **Model benchmarks:** per task category and model: calls, error rate, latency (avg/p95) and cost per call. A recommendation is made only with ≥5 calls on two models.
- **Agent evaluation:** success, verified steps, latency, satisfaction, denied attempts, and a score.
- **Capability R&D:** groups unmet requests into "an existing capability can serve this" or "capability gap". Gaps go through the extension review. Nothing is installed automatically.
- **Knowledge freshness:**
  - FWOS sync age and demo data
  - old or expiring memories
  - old documents
  - evaluation age
  - degraded capabilities
  - model knowledge cutoff
- **Proactive suggestions:** approve, postpone (one week) or dismiss.
- **Family Wealth OS:** categorization suggestions only. They need ≥2 consistent examples from the same merchant; a single example or an ambiguous merchant is skipped with a reason. Approving changes only the listed transactions' category, never amounts, budgets or rules.

## 7. Entities

| Spec entity | Collection |
|---|---|
| LearningEvent | `learning_events` |
| PerformanceSnapshot | `perf_snapshots` |
| FailurePattern | `failure_patterns` |
| FeedbackSignal | `feedback` (category, correction, lang, channel) |
| PreferenceProposal / profile item | `profile_items` |
| ModelBenchmark | `model_benchmarks` |
| ImprovementProposal | `improvement_proposals` |
| Experiment / RegressionReport | `experiments` (`report.rows`, `regressions`, `improvements`, `metrics`) |
| ConfigVersion (prompt, workflow, routing, alias) | `config_versions` |
| Deployment | `deployments` |
| LearningAuditEvent | `learning_audit` (also mirrored to `audit`) |

## 8. API (`/api/v1/learning`)

| Area | Endpoints |
|---|---|
| Overview | `GET dashboard`, `GET/PUT mode`, `GET performance?days&channel&agent&tool&from&to`, `POST performance/snapshot`, `POST cycle`, `GET audit` |
| Failures | `GET signals`, `POST analyze`, `GET patterns`, `POST patterns/:id/dismiss` |
| Proposals | `GET/POST proposals`, `GET proposals/:id`, `POST proposals/:id/experiment`, `POST proposals/:id/approve`, `POST proposals/:id/reject` |
| Experiments and deployments | `GET experiments`, `GET experiments/:id`, `GET deployments`, `POST deployments/:id/rollback` |
| Versions | `GET versions`, `GET versions/:target`, `POST versions/:target/rollback` |
| Feedback and profile | `POST feedback`, `GET profile`, `GET profile/export`, `PUT profile/categories/:id`, `POST profile/items/:id/approve`, `PATCH/DELETE profile/items/:id` |
| Insight | `GET models`, `POST models/benchmark`, `GET agents`, `GET research`, `GET freshness` |
| FWOS and suggestions | `GET fwos/categorization`, `POST fwos/categorization/:id/apply`, `GET suggestions`, `POST suggestions/:id/(approve\|postpone\|dismiss)` |

The scheduler runs one bounded cycle per hour: a snapshot, an analysis, and at most one sandbox experiment.

## 9. Known limits

- The sandbox has no AI model by design. A prompt overlay's effect on live answers is therefore measured after deployment, through feedback, and the report says so.
- Live answer-quality benchmarks need a labelled answer set (see the coverage report).
