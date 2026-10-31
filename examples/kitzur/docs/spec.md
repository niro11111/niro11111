# Kitzur — spec

Short links for the team. No accounts in v1.

## API
- POST /api/links {url} → 201 {code, short}; 400 invalid_url if not http(s)
- GET /:code → 302 to the url and count the click; 404 not_found
- GET /api/links/:code → {code, url, clicks, created_at}; 404 not_found

## Rules
- Codes: 7 chars from an alphabet without look-alikes (no 0/o, 1/l)
- Errors are {code, message}
- Data: SQLite file, path from DB_FILE

## Acceptance
- Create → redirect → stats shows clicks = 1
- javascript: and ftp: urls are rejected
- Unknown codes return 404 on both routes
