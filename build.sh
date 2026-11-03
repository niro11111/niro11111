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
# head material (title, meta, fonts, style) goes into <head>, the app into <body>
python3 - <<'PY'
s = open("src/claude-code-course.html", encoding="utf-8").read()
i = s.index('<div class="app"')
out = ('<!DOCTYPE html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
       + s[:i].strip() + '\n</head>\n<body>\n' + s[i:].strip() + '\n</body>\n</html>\n')
open("index.html", "w", encoding="utf-8").write(out)
PY
echo "built index.html"

# Website / installable app (GitHub Pages): index.html plus the PWA layer from web/
rm -rf site && mkdir -p site/icons
ver=$(sha256sum index.html web/app.js web/sw.js | sha256sum | cut -c1-12)
head='<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#0f1816"><link rel="icon" href="icons/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="icons/icon-192.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta property="og:title" content="אקדמיית Claude Code"><meta property="og:description" content="קורס אינטראקטיבי בעברית ל-Claude Code ממתחילים ועד מומחים"><meta property="og:image" content="icons/icon-512.png">'
python3 - "$head" <<'PY'
import sys
s = open("index.html", encoding="utf-8").read()
s = s.replace("</head>", sys.argv[1] + "\n</head>", 1).replace("</body>\n</html>", '<script src="app.js" defer></script>\n</body>\n</html>', 1)
assert "app.js" in s and "manifest.webmanifest" in s, "site head/body injection failed"
open("site/index.html", "w", encoding="utf-8").write(s)
PY
cp web/app.js web/manifest.webmanifest site/
cp web/icons/* site/icons/
sed "s/__BUILD__/$ver/" web/sw.js > site/sw.js
cp site/index.html site/404.html
touch site/.nojekyll
echo "built site/ (version $ver)"

# Downloadable copies: one HTML file and the zipped web app
mkdir -p dist
cp index.html dist/claude-code-academy.html
rm -f dist/claude-code-academy-webapp.zip
(cd site && zip -qr ../dist/claude-code-academy-webapp.zip . -x '404.html')
echo "built dist/"
