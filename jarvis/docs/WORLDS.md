# JARVIS Digital World Engine: implementation report

The engine turns a natural-language idea into a working project through a traceable process:
request → specification → architecture → mission (agents) → code → real build → real tests → live HTTP verification → signed artifact → local deployment → monitoring.

Every feature carries exactly one status: `PLANNED · IMPLEMENTED · CONFIGURED · CONNECTED · TESTED · VERIFIED · BLOCKED · FAILED`. Statuses change only from execution results: exit codes, test reports and HTTP checks.

## 1. Repository audit (Phase A) and reuse

| Existing component | How the engine uses it |
|---|---|
| Mission Engine (`brain/missions.js`) | Each pipeline is a mission DAG with dependencies, pause/resume/cancel, idempotency keys and evidence |
| Agent registry | New agent **Builder** (`builder`), with its own tool allow-list, a `write` risk ceiling and a 300 s timeout. The Executive agent can delegate to it |
| CORE `runFromModel` | Every stage is a tool call through policy, the agent ceiling, timeout, evidence and `verify()` |
| Capability Registry | The `world.*` tools appear automatically, with health |
| Devlab isolation and signing (`learn/sign.js`) | Artifacts are signed (SHA-256 + keyed signature) |
| Store / SQLite database | All world entities are collections, persisted in the dedicated SQLite database on the server |
| Audit, notifications, scheduler | Every action is audited; running worlds are health-checked every 5 minutes |

## 2. Architecture

```
server/worlds/spec.js       Stage 1-2: understand (he/en, templates, explicit entities, questions) + architect
server/worlds/generator.js  Stage 4: deterministic project generation from the spec
server/worlds/template/*    the generated app: server (no deps), UI, tests (raw-string templates)
server/worlds/engine.js     workspace, stages, features, mission, deploy, monitoring, incidents, kill switch, integrations
server/worlds/runner.js     real execution (Node server only): node --check, node --test, HTTP verification, previews
web/js/worldsview.js        Digital World Control Center
```

A generated project contains:
- `package.json`, `schema.json`
- `server.js`: REST API, validation, token auth, CSP and security headers, atomic JSON persistence, metrics
- `public/`: a responsive UI built from the schema; user data is never written with innerHTML
- `tests/api.test.js`: about 11–20 tests against the real server
- `Dockerfile`, `.env.example` (no real values), `README.md`

## 3. Vertical slice (Phase C): status VERIFIED

Real run, also covered by `tests/worlds.test.js` and the UI e2e:

```
chat: "Build me a CRM system for my company called Acme Solar"
→ world.create (Builder) → spec: 3 entities (Contacts, Deals, Activities), assumptions listed
→ mission: architect → generate → build → test → verify, all done by the Builder agent
→ build: node --check on every file, JSON/HTML checks, acme-solar-v1.tar.gz (SHA-256 recorded, signed)
→ tests: 14/14 passed (node --test in the workspace)
→ live verification: 7/7 HTTP checks (start, health, UI, 401 without token, create, persisted on disk, 400 on bad input)
→ deploy local-preview: VERIFIED (health 10 ms), the app answers at http://127.0.0.1:<port>/
→ kill switch: process stopped, further runs refused
```

Total time is about 0.7 s.

Other types built and verified the same way:

| Type | Tests |
|---|---|
| Company website (public contact form) | 11/11 |
| Custom data model in Hebrew | 11/11 |
| Digital business (website + CRM + orders + support) | 20/20 |
| Inventory | 14/14 |

## 4. Status of every capability

### Implemented, tested and verified
- Understand (he/en): templates for CRM, store, booking, projects, finance, inventory, support, website, education and digital business. Explicit entities `name (field, field)`. Name, budget and integrations are extracted. One clarification question when the type is unclear; requirements are never invented.
- Architecture: components, database tables and indexes, roles, API, security design, deployment and testing strategy.
- Mission with dependencies, assigned to the Builder agent, through CORE (policy, evidence, `verify()` per stage).
- Code generation (deterministic) with per-file SHA-256, version history and specification editing (each edit creates a new version).
- Real build, real tests, live HTTP verification and a signed `.tar.gz` artifact (downloadable through the authenticated API).
- Local deployment (managed process), health checks with latency and app metrics, logs, incidents with diagnosis and remediation, stop, kill switch.
- Failure handling, tested: a broken file fails the build with an incident, a failing test fails the stage, and later stages are blocked.
- Permissions: only the owner can create, change, run, deploy, stop or kill (device tokens get 403). Path traversal and invalid IDs are refused. There is a daily budget per world.
- Browser build: code generation works, and execution stages are BLOCKED with the exact reason. No feature is marked as tested.

### Blocked (exact blocker)

| Capability | Status | What is needed |
|---|---|---|
| Docker deployment | BLOCKED | Docker on the JARVIS host, plus an approved deployment policy. The Dockerfile is generated (IMPLEMENTED, not built) |
| Cloud deployment | BLOCKED | A hosting provider and credentials configured on the server |
| GitHub export | BLOCKED → CONFIGURED/CONNECTED | `GITHUB_TOKEN` on the server; "Verify connections" checks it against the GitHub API |
| Anthropic models | CONFIGURED when a key exists | `ANTHROPIC_API_KEY`, or opening JARVIS in claude.ai |
| Stripe, Google Workspace, Microsoft 365, e-mail delivery, cloud hosting | BLOCKED | Official API credentials or OAuth. No fake credentials are ever used, and no mock is silently substituted |
| Builds, tests and deployments inside the browser / single HTML file | BLOCKED | The JARVIS server (`npm start`) |

### Planned (not implemented yet)
- App-store publishing, mobile builds (Expo/EAS) and desktop packaging for generated projects.
- Model-assisted custom business logic on top of the generated CRUD core. It would go through Devlab static analysis and tests before inclusion.
- Market and competitor research for the business factory. This needs the research tool with a model; such research will be labelled as research, separately from assumptions.
- Per-project secrets vault with OAuth flows, multi-user roles in generated apps, database choice (SQLite or PostgreSQL) for generated apps, staging/production separation, and automatic remediation after approval.

## 5. Data model

| Entity | Collection |
|---|---|
| DigitalWorld | `worlds` (spec, architecture, stages, features, budget, usage, owner, killed) |
| DigitalWorldVersion | `world_versions` |
| ProjectArtifact | `world_files` (source, SHA-256), `world_artifacts` (package, signature) |
| Build / test / verification | `world_builds`, `world_test_runs`, `world_verifications` |
| ProjectDeployment | `world_deployments` |
| ProjectHealthCheck | `world_health_checks` |
| ProjectIncident | `world_incidents` |
| ProjectAuditLog | `world_audit` (also mirrored in `audit`) |
| ProjectTask / Milestone / Dependency | the world's mission (`missions`, tasks with `dependsOn`) |
| ProjectBudget / ProjectUsage | `worlds.budget`, `worlds.usage` |

On the server everything is stored in SQLite (`records`), and can be queried from the Database screen.

## 6. API (`/api/worlds`, owner token)

| Area | Endpoints |
|---|---|
| Worlds | `GET /` (overview), `POST /` `{text, run}`, `GET /:id` (dashboard), `DELETE /:id` (archive) |
| Design | `POST /:id/clarify` `{answer}`, `PUT /:id/spec` (new version), `POST /:id/architect`, `POST /:id/plan`, `POST /:id/run` `{wait}` |
| Stages | `POST /:id/generate`, `POST /:id/build`, `POST /:id/test`, `POST /:id/verify` |
| Deployment | `POST /:id/deploy` `{target: local-preview, docker, cloud}`, `POST /:id/stop`, `POST /:id/health`, `POST /:id/kill` `{release}` |
| Files and logs | `GET /:id/files`, `GET /:id/file?path=`, `GET /:id/tests/:runId`, `GET /:id/logs` |
| Artifact | `GET /:id/artifact` (binary, authenticated) |
| Integrations | `GET /integrations[?verify=1]` |

## 7. Security

- One workspace per world and version.
- Child processes get only `PATH/NODE_ENV/HOME/TMPDIR` and never JARVIS secrets.
- Timeouts: tests 120 s, startup 10 s. Output is capped.
- Apps bind to 127.0.0.1.
- Each world has its own admin token, stored only on the JARVIS server.

The generated code comes from JARVIS's own templates, not from a model. Model-written code would go through Devlab's static analysis and isolation.

**Limit:** child processes are not network-sandboxed by the OS. For untrusted code, run the runner inside a container.

## 8. Verification results (Phase E)

| Suite | Result |
|---|---|
| `npm test` | 117/117 (including 7 Digital World tests) |
| `tests/e2e/ui.e2e.mjs` | all screens, plus the full flow in the browser: create from a preset, real pipeline, verified, deploy, live app, cloud BLOCKED, kill switch |
| `tests/e2e/webapp.e2e.mjs` | in the browser build, generation works and execution is honestly BLOCKED; single HTML file still works |

## 9. Next priorities

1. GitHub export of a verified world to a new branch or repository (adapter exists as a status check; needs `GITHUB_TOKEN`).
2. Docker build and run with an approved deployment policy and rollback to the previous image.
3. Model-assisted custom logic, gated by Devlab analysis and the project's own tests.
4. Per-world secrets vault and OAuth integration flows.
5. Business factory research, using the research tool with sources.
