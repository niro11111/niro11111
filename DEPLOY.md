# מדריך העלאה לאוויר (Production)

המדריך מסביר איך מעלים את אקדמיית Claude Code לשימוש אמיתי, צעד אחר צעד. בוחרים דרך אחת לפי מה שצריך.

| הדרך | מה מקבלים | עלות | זמן |
| --- | --- | --- | --- |
| **claude.ai** (כבר פעיל) | כל הקורס, המורה (AI) וסנכרון בין המכשירים שלכם | כלול בחשבון | 0 |
| **GitHub Pages** | אתר ציבורי וקבוע, אפליקציה להתקנה, עובד גם בלי אינטרנט. בלי חשבונות ובלי שרת | חינם | 2 דקות |
| **Fly.io** | השרת המלא: חשבונות, סנכרון, תעודות עם קישור אימות, מורה AI, ‏webhooks | לפי שימוש (שרת קטן עם volume של 1GB) | 15 דקות |
| **שרת משלכם (Docker)** | אותו שרת מלא, על כל מכונה עם Docker | לפי השרת | 20 דקות |

## לפני שמתחילים: רשימת בדיקה

- [ ] הבנייה והבדיקות עוברות: `./build.sh && (cd server && npm ci && npm test)`.
- [ ] יש כתובת HTTPS (הפלטפורמה נותנת אותה, או reverse proxy כמו Caddy או Nginx).
- [ ] ‏`PUBLIC_URL` מוגדר לכתובת הסופית, למשל `https://academy.example.com`.
- [ ] ‏`COOKIE_SECURE=true` (ברירת המחדל ב-production).
- [ ] ‏`TRUST_PROXY=true` רק כשיש proxy או פלטפורמה לפני השרת (ב-Fly כבר מוגדר).
- [ ] ‏`ADMIN_EMAILS` מכיל את האימייל שלכם, כדי לראות סטטיסטיקות ב-`/api/admin/stats`.
- [ ] סודות (מפתח API, ‏`WEBHOOK_SECRET`, ‏`INTEGRATION_TOKEN`) נשמרים כסודות של הפלטפורמה או בקובץ `.env`, ואף פעם לא ב-git. ‏`.env` כבר נמצא ב-`.gitignore`.
- [ ] סוד אקראי וחזק לכל טוקן: `openssl rand -hex 32`.

## 1. ‏GitHub Pages (אתר סטטי, חינם)

1. במאגר ב-GitHub: **Settings ← Pages ← Source: GitHub Actions**.
2. **Actions ← Deploy website ← Run workflow** (או כל push לענף).
3. האתר עולה בכתובת `https://<user>.github.io/<repo>/`. מאז כל push מעדכן אותו.

דומיין משלכם: באותו מסך, ‏**Custom domain**, ורשומת CNAME אצל ספק הדומיין.

## 2. ‏Fly.io (השרת המלא)

ההגדרות כבר נמצאות ב-`fly.toml`: ‏HTTPS מאולץ, בדיקת `/readyz`, ‏volume בשם `academy_data` ומכונה שנעצרת כשאין תנועה.

```bash
curl -L https://fly.io/install.sh | sh        # flyctl
fly auth login
fly launch --no-deploy                         # pick an app name; it is written into fly.toml
fly volumes create academy_data --size 1 --region fra
fly secrets set PUBLIC_URL=https://<app>.fly.dev ADMIN_EMAILS=you@example.com
fly deploy
curl https://<app>.fly.dev/readyz              # {"ok":true,"db":"up","site":true}
```

אופציונלי:

```bash
# AI tutor on your server (the key never reaches the browser)
fly secrets set ANTHROPIC_API_KEY=sk-ant-... AI_MODEL=<model id from the Anthropic models page>
# Make / Zapier / n8n
fly secrets set WEBHOOK_URL=https://hook.eu1.make.com/... WEBHOOK_SECRET=$(openssl rand -hex 32)
fly secrets set INTEGRATION_TOKEN=$(openssl rand -hex 32)
# your own domain
fly certs add academy.example.com
```

## 3. שרת משלכם עם Docker

```bash
git clone <your repo> academy && cd academy
cp .env.example .env          # set PUBLIC_URL, ADMIN_EMAILS and the optional keys
docker compose up -d --build
curl http://localhost:8080/readyz
```

הקונטיינר רץ כמשתמש רגיל, עם מערכת קבצים לקריאה בלבד ו-`no-new-privileges`. הנתונים נשמרים ב-volume בשם `academy-data`. לפני הקונטיינר שמים reverse proxy עם HTTPS, ומגדירים `TRUST_PROXY=true`. למשל ב-Caddy:

```
academy.example.com {
  reverse_proxy localhost:8080
}
```

## גיבויים ושחזור

- **אוטומטי**: בקונטיינר (Docker ו-Fly) יש גיבוי מלא של מסד הנתונים כל 24 שעות ל-`/data/backups`, בזמן שהשרת רץ. נשמרים 14 הגיבויים האחרונים, והישנים נמחקים כדי שהדיסק לא יתמלא. משנים עם `BACKUP_EVERY_HOURS` ו-`BACKUP_KEEP`.
- **ידני, ברגע זה**: `node scripts/backup.js` מתוך `server/` (בקונטיינר: `docker compose exec academy node scripts/backup.js`, ב-Fly: `fly ssh console -C "node scripts/backup.js"`).
- **עותק מחוץ לשרת**: הגיבויים נמצאים על אותו volume כמו המסד. כדאי להעתיק אותם מדי פעם למקום אחר:
  - Fly: `fly ssh sftp get /data/backups/<file>`
  - Docker: `docker compose cp academy:/data/backups ./backups`

**שחזור** (בלי להעתיק מעל קובץ פתוח): מעתיקים את הגיבוי לשם חדש, ומפנים אליו את השרת.

```bash
# Fly
fly ssh console -C "cp /data/backups/<file>.db /data/restored.db"
fly secrets set DATABASE_PATH=/data/restored.db      # restarts the server on the restored copy

# Docker
docker compose exec academy cp /data/backups/<file>.db /data/restored.db
echo "DATABASE_PATH=/data/restored.db" >> .env && docker compose up -d
```

## עדכון לגרסה חדשה

```bash
git pull
fly deploy                       # or: docker compose up -d --build
```

שינויי מבנה במסד הנתונים (migrations) רצים לבד בהפעלה, ממוספרים ובסדר. השרת נכבה בצורה מסודרת (SIGTERM), כך שבקשות פתוחות מסתיימות לפני הכיבוי.

## ניטור

- `GET /healthz`: השרת חי. ‏`GET /readyz`: המסד והאתר זמינים. מחברים אותם לשירות ניטור (UptimeRobot, ‏Better Stack ועוד).
- לוגים מובנים ב-JSON, בלי עוגיות ובלי סיסמאות: `fly logs` או `docker compose logs -f`.
- סטטיסטיקות לשימוש: `GET /api/admin/stats`, אחרי התחברות עם אימייל שמופיע ב-`ADMIN_EMAILS`.

## פרטיות ואבטחה

- סיסמאות נשמרות כ-scrypt, ו-sessions כ-hash בעוגייה HttpOnly ו-Secure. יש הגנת CSRF והגבלת קצב, ונעילה אחרי ניסיונות כושלים.
- ‏CSP קשיח עם hash לכל סקריפט, ו-headers מאובטחים (helmet).
- כל משתמש יכול לייצא את כל הנתונים שלו ולמחוק את החשבון מתוך האפליקציה.
- ‏Webhooks חתומים ב-HMAC, וכברירת מחדל בלי אימייל של המשתמש (`WEBHOOK_INCLUDE_PII=false`).
- מכסה יומית לבקשות AI לכל משתמש (`AI_DAILY_REQUESTS`), כדי שהעלות תהיה צפויה.

## תקלות נפוצות

| מה רואים | הסיבה והפתרון |
| --- | --- |
| השרת לא עולה והלוג מציג שם של משתנה | ערך לא תקין ב-`.env` או בסודות. הודעת השגיאה אומרת מה מצופה. |
| התחברות לא נשמרת | ‏`COOKIE_SECURE=true` על http. עבדו עם HTTPS, או מקומית הגדירו `COOKIE_SECURE=false`. |
| שגיאת 403 "בקשה ממקור לא מורשה" בכל שמירה | ה-proxy משנה את כותרת Host (למשל ל-localhost). הגדירו `PUBLIC_URL` לכתובת הציבורית, או הגדירו את ה-proxy להעביר את Host המקורי. |
| כתובות IP של כל המשתמשים זהות (והגבלת הקצב חוסמת את כולם) | חסר `TRUST_PROXY=true` מאחורי proxy. |
| ‏`/readyz` מחזיר site:false | לא הורצה הבנייה. ‏`./build.sh` יוצר את `site/`. ב-Docker זה קורה לבד. |
