# JARVIS for Wear OS

Kotlin + Compose for Wear OS (API 30+). **Not built in this repository's CI** (no Android SDK on the build machine).

- `MainActivity.kt` – glance, voice input via the platform speech recognizer (only on tap), approvals, task completion, quick actions
- `JarvisApi.kt` – watch-scoped client + idempotent offline queue
- `JarvisTileService.kt` – tile with pending approvals / next task, refreshed every 15 minutes
- `HealthSync.kt` – optional Health Services step upload (consent + Privacy Center switch required)

## Build
Open `apps/wearos` in Android Studio (Koala+), let Gradle sync, run on a Wear OS emulator or watch.
Register a `wearos` device in the JARVIS Device Center and enter the URL/token on first run (stored in app prefs).
