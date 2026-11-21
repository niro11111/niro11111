# JARVIS ML layer, knowledge graph and dedicated database

Everything here runs on the user's own device or server: no ML service, no external database and no data sent anywhere. All of it works both on the Node server and in the browser build.

| Area | Code |
|---|---|
| ML library | `server/ml/nn.js` (neural network), `features.js`, `algorithms.js` |
| ML models | `intent-model.js`, `service.js` (registry) |
| Knowledge graph | `server/knowledge/graph.js` |
| Database | `server/db/sqlite.js` |
| Screens | Neural Lab, Knowledge Graph, Database (`web/js/mlview.js`) |
| Tests | `tests/ml.test.js`, webapp e2e |

## 1. Neural network library (`nn.js`)

A dependency-free multi-layer perceptron:

- **Architecture:** dense layers, ReLU, softmax and cross-entropy.
- **Training:**
  - Adam optimizer, mini-batches, L2 weight decay, inverted dropout.
  - Early stopping on a validation split; the best epoch is restored.
  - Class weighting for imbalanced data.
  - Seeded He initialization and shuffling, so a training run is reproducible.
- **Sparse first layer:** hashed text vectors are mostly zeros, so training takes about 2–3 seconds, in the browser too.
- **Evaluation:** confusion matrix, per-class precision/recall/F1, macro-F1, and calibration (expected calibration error).
- **Correctness:** checked by a test that learns XOR, a non-linear problem a linear model cannot solve.

Text features (`features.js`):
- **Hebrew normalization:** niqqud removed, final letters unified, one-letter prefixes (ו/ה/ב/ל/מ/ש/כ) split off as an extra token, numbers masked.
- **Feature groups:** word unigrams and bigrams, and character trigrams (robust to morphology and typos).
- **Encoding:** hashed into 2,048 dimensions with weighted sub-linear TF and L2 normalization. Hashing means the model file contains no raw vocabulary.

## 2. Neural intent router

- **Problem:** the deterministic parser handles the phrasing it knows. Everything else fell through to the language model, and failed when no model was available.
- **Model:** MLP 2048 → 64 (ReLU) → 16 (softmax), about 132k parameters, over 15 read-only capabilities plus an "open question" class.
- **Training data** (labelled without any model):
  1. A curated Hebrew and English paraphrase corpus.
  2. The deterministic parser as a weak labeller: it is authoritative, and the network is never trained to disagree with it.
  3. The user's completed single-step requests and approved learned phrases.
  4. Augmentation: prefixes, suffixes and word dropout.
- **Held-out evaluation** on originals that are never augmented: accuracy, macro-F1, calibration, and the safety metric **routing precision**. Routing precision is how often the router is right when it would act. On the current corpus it is 100% (zero false routes) at about 40% coverage.
- **Guarded decisions:** the router acts only when every condition holds:
  - the deterministic parser had no rule for the request;
  - the predicted capability is read-only;
  - probability ≥ 0.85 and margin ≥ 0.5;
  - the request shares a content word with that capability's training examples (lexical support), which blocks confident nonsense such as "who was Napoleon".
- **Production activation is not automatic.** The `ml.routing` target is versioned, which means:
  - It must pass a sandbox experiment: the full regression suite plus replays of real failed requests, with no regressions allowed.
  - It needs owner approval and can be rolled back.
  - It is refused if the model's routing precision is below 0.9 or its weights fail their signature check.

## 3. Classic algorithms (`algorithms.js`)

| Algorithm | Use | Safeguards |
|---|---|---|
| Multinomial Naive Bayes (Laplace) | Category suggestions for uncategorized expenses (description tokens + amount bucket) | Leave-one-out accuracy. A suggestion needs p ≥ 0.8, ≥ 3 examples in its class and a matching word. It is applied only on approval, and only the category changes |
| Holt's linear exponential smoothing | Monthly spending forecast, total and per category | α and β grid-searched by one-step error; 95% intervals from residuals; MAPE. Only complete months are used |
| Modified z-score (MAD) | Unusual expenses within each category | Robust to outliers; flags score ≥ 3.5 |
| k-means++ with silhouette | Groups of unmet requests (capability gaps) | Stemmed content-word vectors; k chosen by silhouette, with a parsimony margin |

## 4. Model registry (`service.js`)

- **Versions:** every training run creates a signed challenger version with metrics, training curve, configuration and a dataset digest.
- **Promotion:** champion/challenger. Only the owner promotes, and never a model that is worse on held-out data.
- **Integrity:** weights are verified before loading, so tampered weights are refused.
- **Retraining:** the learning cycle retrains the router when at least 25 new completed requests exist. The result is a challenger only.

## 5. Knowledge graph (`graph.js`)

- **Sources:** memories (except the financial and health domains), notes, documents, tasks and calendar events.
- **Extraction** (Hebrew and English patterns):
  - family and work relationships ("my wife Dana", "אחי יואב")
  - where people work ("works at", "עובד ב")
  - where they live ("lives in", "גר ב")
  - birthdays, projects and proper nouns
  - co-occurrence links
- **Provenance:** every node and edge records the records it came from.
- **Importance:** PageRank.
- **Queries:**
  - "who is X?" / "מי זה X" returns facts with sources.
  - "how is X related to Y?" / "מה הקשר בין X ל-Y" returns the shortest path (BFS).
  - Core routes these to the graph only when X is a known entity; otherwise they remain open questions.
- **Freshness:** the graph rebuilds automatically when a source record changed.

## 6. Code-assisted computation

`compute.code` ("run code: …" / "חשב בקוד: …") runs a pure JavaScript expression or `function run(input)`:
- It first goes through the Development Lab's static analysis: no network, modules, globals, eval or timers.
- It then runs in the isolated runner: a Web Worker or a Node `vm` context, with a 1.5-second timeout.
- A blocked attempt is reported as a safety block, not as a temporary error.

## 7. Dedicated database (`db/sqlite.js`)

- **Engine:** SQLite, built into Node 22, in a single file `data/jarvis.db`. No database server is needed.
- **Schema** (migrations recorded in `schema_migrations`):
  - `records(collection, id, data JSON, created_at, updated_at)` for every entity, with a JSON validity check;
  - `meta(key, value)`;
  - typed SQL views: `v_transactions`, `v_tasks`, `v_memories`, `v_requests`, `v_tool_executions`, `v_audit`, `v_proposals`, `v_versions`, `v_ml_models`, `v_kg_edges`.
- **Writes:**
  - The in-memory store stays the fast working set.
  - Changes are flushed in coalesced transactions (every 40 ms).
  - Each flush writes only the rows that actually changed (a row-level diff), and deletes removed rows.
  - WAL journal mode: crash-safe, and readers never block writers.
- **Migration:** an existing `data/jarvis.json` is imported once and kept as a `.bak`.
- **Owner tools:**
  - `GET /api/db/status`
  - `GET /api/db/integrity` (`PRAGMA integrity_check`)
  - `POST /api/db/backup` (`VACUUM INTO data/backups/…`)
  - `POST /api/db/query`: a read-only SQL console with a single SELECT/WITH statement, on a separate read-only connection, with capped rows
- **Browser:** the web app keeps using the claude.ai per-user database or localStorage. The Database screen says which one is in use.

## 8. API

| Area | Endpoints |
|---|---|
| ML | `GET /api/ml/status`, `GET /api/ml/models[?name]`, `GET /api/ml/models/:id`, `POST /api/ml/train/intent`, `POST /api/ml/train/categorizer`, `POST /api/ml/models/:id/promote`, `POST /api/ml/models/:id/propose-routing`, `POST /api/ml/predict`, `GET /api/ml/categories`, `POST /api/ml/categories/:txId/apply`, `GET /api/ml/forecast`, `GET /api/ml/anomalies`, `GET /api/ml/clusters` |
| Knowledge graph | `GET /api/knowledge/graph`, `POST /api/knowledge/graph/rebuild`, `GET /api/knowledge/graph/about?name=`, `GET /api/knowledge/graph/path?a=&b=` |
| Database | `GET /api/db/status`, `GET /api/db/integrity`, `POST /api/db/backup`, `POST /api/db/query` |

## 9. Performance

`npm run load:test` sends 600 mixed requests at concurrency 20 (commands, finance, learning, graph, neural predictions, capability search). Result:

| Throughput | p50 | p95 | Errors |
|---|---|---|---|
| ~2,000 requests/second | 3.7 ms | 18 ms | 0 |

## 10. Limits

- The router is trained on a curated corpus plus your history. Its held-out accuracy across all classes is about 57%. That is why it acts only when precise (100% on held-out data) and otherwise leaves the request to the language model. It improves as your history grows.
- Forecasts are statistical planning aids, not financial advice. With fewer than 6 months of history they are flagged as rough.
- The SQLite module in Node 22 is marked experimental by Node. The JSON store remains available (`JARVIS_DB_ENGINE=json`).
