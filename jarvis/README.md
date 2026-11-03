# J.A.R.V.I.S AI: Personal Intelligence OS

A working first release of JARVIS. It includes the core orchestrator, 12 specialised agents, typed long-term memory, the Family Wealth OS integration, smart home control, productivity, automations, notifications, a security layer, a desktop bridge, and a web command center with voice in Hebrew and English.

```bash
cd jarvis
npm install
npm start          # http://127.0.0.1:7777, then paste the token printed in the console
npm test           # 29 tests: core, domain, HTTP API
```

It runs without any configuration. JARVIS starts with a demo household (labelled **demo data** in the UI) and a demo smart home. Connect real services with environment variables:

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Enables Claude for open questions, web research and page summaries. Without it, built-in commands still work offline, and open questions fail with a clear message rather than a made-up answer |
| `JARVIS_MODEL_FAST` / `_BALANCED` / `_DEEP` | Override the model for each routing tier (defaults: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`) |
| `HA_URL`, `HA_TOKEN` | Use a real Home Assistant instance in place of the demo home. Matter and MQTT devices come in through Home Assistant |
| `JARVIS_TOKEN` | Fixed API token. If unset, one is generated and stored in `data/jarvis.json` |
| `JARVIS_HOST`, `PORT`, `JARVIS_DATA` | Bind address (default `127.0.0.1`), port, and data file |

Desktop control runs through a separate local process that the user starts and restricts:

```bash
JARVIS_TOKEN=<token> JARVIS_ALLOWED_DIRS=~/Documents JARVIS_ALLOWED_APPS=calculator,code node desktop/bridge.js
```

## What you can say

| Example | What happens |
|---|---|
| "JARVIS, organize my day" / "תארגן לי את היום" | Daily briefing: schedule, tasks, bills, approvals, offline devices, next action |
| "כמה הוצאנו החודש?" / "How much did we spend this month?" | Deterministic spending analysis with comparison to last month and recommendations |
| "Find unnecessary expenses", "Which upcoming payments require attention?", "Show our total financial assets", "How are we progressing toward our savings goals?", "Prepare a financial report" | Family Wealth OS read and analysis tools |
| "Transfer 500 to Dan" | Detected as money movement, asks for approval, and is **never executed**. The attempt is logged as blocked |
| "Turn off the lights downstairs", then "turn them on" | Resolves the devices, executes, verifies the real state, and remembers "them" for the next command |
| "Set the temperature to 23", then "no, 22" | Applies the correction to the previous command |
| "Unlock the front door" | Sensitive action: waits in `AWAITING_APPROVAL` until you approve |
| "Remind me to pay the electricity bill tomorrow at 9" | Creates a reminder (not a payment). A notification fires when it is due |
| "Turn off the lights and then remind me to lock up in 10 minutes" | A two-step plan run in order |
| "Remember that I prefer short answers" / "What do you know about…" | Memory, tagged with where each fact came from |
| A URL, or "research …" | Fetches the page as untrusted content, flags injection attempts, and summarises it (needs an AI provider) |

## Layout

```
server/
  core/        orchestrator (JARVIS CORE), states, intent parser (he/en), model router
  agents/      12 agents with tool allow-lists and step limits
  tools/       tool registry (risk-tagged, verify()), research fetcher, desktop bridge broker
  security/    permission policy, audit log, untrusted-content guard, auth
  memory/      typed memory with provenance, local embeddings, semantic search
  wealth/      deterministic finance calculations + Family Wealth OS service
  home/        Home Assistant adapter + demo home
  productivity/ tasks, calendar, reminders, briefings, he/en time parsing
  automation/  workflow engine
  notify/      notifications (priority, quiet hours, grouping, channels)
  proactive/   priority-scored proactive suggestions
  documents/   chunking + semantic document search
web/           command center (vanilla JS, no build step, PWA manifest)
desktop/       desktop bridge (least-privilege local executor)
docs/          ARCHITECTURE.md: design, security model, roadmap
tests/
```

Read `docs/ARCHITECTURE.md` for the design, the security model, and what is built versus planned.
