#!/usr/bin/env bash
# Wraps the artifact source (src/claude-code-course.html) into a standalone page.
set -euo pipefail
cd "$(dirname "$0")"
{
  echo '<!doctype html>'
  echo '<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>'
  cat src/claude-code-course.html
  echo '</body></html>'
} > index.html
echo "built index.html"
