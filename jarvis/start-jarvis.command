#!/usr/bin/env bash
# Start JARVIS. Add --public for a real https address (needs cloudflared), --lan for phones on the same Wi-Fi.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Node.js 22+ is required: https://nodejs.org"; exit 1; }
exec node scripts/start.mjs "$@"
