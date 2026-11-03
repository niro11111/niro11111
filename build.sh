#!/usr/bin/env bash
# Wraps the artifact source (src/claude-code-course.html) into a standalone page,
# after checking that its inline script parses.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
python3 - "$tmp/page.js" <<'PY'
import sys
s = open("src/claude-code-course.html", encoding="utf-8").read()
open(sys.argv[1], "w", encoding="utf-8").write(s[s.index("<script>") + 8 : s.rindex("</script>")])
PY
node --check "$tmp/page.js" || { echo "build failed: script syntax error" >&2; exit 1; }
{
  echo '<!doctype html>'
  echo '<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>'
  cat src/claude-code-course.html
  echo '</body></html>'
} > index.html
echo "built index.html"
