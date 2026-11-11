# AI across JARVIS, wake word and renaming

## Wake word ("Hey JARVIS" / "ג'ארוויס")

| | |
|---|---|
| Turn on | 👂 button in the top bar. A one-time notice explains that the microphone stays open while the page is open, and that the browser recognizes speech (Chrome and Edge send audio to their speech service) |
| Say | "ג'ארוויס, מה יש לי היום?", or just "ג'ארוויס", then wait for the chime and speak within 8 seconds |
| Matching (`web/js/wake.js`) | Word-by-word normalization (niqqud, final letters, geresh), known spellings (ג׳ארוויס, גארוויס, jervis …), and edit distance of about one per five letters. A phonetic skeleton difference is allowed only in the first sound (J/CH/G/H). Only greetings may come before the name. The command is passed on exactly as spoken |
| Rejected | "jars of water", "harvest moon", "מרוויח כסף", "גרביים חדשים", and the name in the middle or end of a sentence |
| Self-protection | While JARVIS speaks, or push-to-talk is active, wake mode ignores what it hears |
| Settings → Wake word | On/off, plus a test box: type a sentence the way the microphone would hear it and see whether it would wake him and what the command is |
| Limits | Browser-based: works only while the page is open. claude.ai blocks the microphone, and wake mode says so. On-device wake detection is the next step (see `BREAKTHROUGH.he.md`) |

## Renaming

| | |
|---|---|
| By voice or chat | "מעכשיו קוראים לך פריידי", "your name is Friday", "שנה את מילת ההפעלה למחשב", "change the wake word to Computer". These run through the tools `settings.rename` and `settings.wake` (write risk, audited, verified) |
| In Settings | Name and wake word fields. The name must be at least 2 characters |
| Effect | Brand, page title, the system prompt ("You are Friday …"), "who are you?" answers, and the wake listener update immediately. The name and wake word are also stripped from commands ("Friday, organize my day" works) |

## AI layer

| Feature | What it does | Without a model |
|---|---|---|
| Copilot on every screen (✦, Ctrl+K) | Answers questions about the current screen. The server builds the context from its own data (finance, learning, worlds, planner, home, missions, neural, graph, database); the page sends only the screen name. Each screen has suggested questions | Says what is needed and still returns the data |
| AI world designer | When no template fits, or "design with AI" is checked, Claude designs the data model as JSON constrained by a schema (`output_config.format`). JARVIS validates it, with one corrective retry; invalid output is never accepted. It is marked "proposed by AI, review" | Falls back to the deterministic templates and questions |
| Provider | Automatic prompt caching (`cache_control`), server-side refusal fallbacks (`fallbacks: "default"`), refusal category, structured JSON output, and a manual tool loop with all results in one message | Local engine for built-in commands |
| Existing AI | Chat with tools through the permission policy, deep thinking, decisions, research with sources, vision, generators, app builder, agents, missions, model benchmarks, Development Lab code generation | Each says what is missing |

Model output is always data: it is validated, never executed directly, and it cannot change permissions, money or settings by itself.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/ai/status` | providers, route, AI features |
| `GET /api/ai/suggested?screen=&lang=` | suggested questions for a screen |
| `POST /api/ai/copilot {screen, question, lang, worldId?}` | ask the copilot |
| `POST /api/worlds {text, ai:true}` | AI-designed world |
| `PUT /api/settings/personality {name, wakeWord}` | rename / set the wake word |

## Tests

- `tests/assistant.test.js` (5 tests): wake matching with positives and negatives, rename by voice and stripping, the AI designer with schema, caching, fallbacks and corrective retry, honest behavior with no model, copilot grounding.
- `tests/e2e/webapp.e2e.mjs`: simulated speech. Saying "ג׳ארוויס כמה הוצאנו החודש" runs the command; a sentence without the wake word is ignored; a voice rename changes the brand and the wake word; the copilot opens on a screen.
