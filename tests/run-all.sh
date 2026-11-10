#!/usr/bin/env bash
# Builds everything and runs every test. Exit code is non-zero if anything fails.
set -uo pipefail
cd "$(dirname "$0")/.."
./build.sh || exit 1
fail=0
run(){ local name=$1; shift; local out; out=$("$@" 2>&1); local code=$?
  if [ $code -ne 0 ] || grep -qE '^FAIL|errors \[[^]]' <<<"$out"; then echo "✗ $name"; grep -E '^FAIL|errors \[' <<<"$out" | head -5; fail=1; else echo "✓ $name"; fi; }
run "complete the whole course (64 chapters, exam, simulator commands)" node tests/e2e-complete-course.js
run "two-device sync"                     node tests/e2e-sync-full.js
run "installable web app (PWA)"           node tests/e2e-pwa.js
run "expert pack install + validation"    node tests/validate-pack.js
run "toolbox features"                    node tests/e2e-toolbox.js
run "dashboard, backup, analyzer"         node tests/e2e-dashboard-sync.js
run "contrast in every theme"             node tests/contrast.js
run "complete guide + prompt generator"  node tests/e2e-guide-promptgen.js
run "error decoder, endless quiz, ecosystem" node tests/e2e-v3.js
run "workspace: theme, keys, status line" node tests/e2e-workspace.js
run "every generated bash script parses"  node tests/scripts-syntax.js
run "system health (links, a11y, phone width, storage)" node tests/health.js
run "code terminal: review, spec, zip, ai"  node tests/e2e-codeterm.js
run "server API (accounts, security, sync, certificates)" bash -c "cd server && npx vitest run"
run "full stack: real server + two browsers" node tests/e2e-fullstack.js
run "AI gateway: tutor, JSON, tool loop" node tests/e2e-ai-gateway.js
run "Make chapter + real hook run"     node tests/e2e-make.js
run "every button in every chapter"       node tests/audit-buttons.js
[ $fail -eq 0 ] && echo "all tests passed" || echo "some tests failed"
exit $fail
