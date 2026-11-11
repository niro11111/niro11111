# JARVIS for Apple Watch

SwiftUI source for watchOS 10+. It was **not compiled in this repository's CI** (no Xcode on Linux).

| File | What it does |
|---|---|
| `JarvisWatchApp.swift` | Glance (state ring, weather, next event, tasks), dictation questions, quick actions, approvals |
| `JarvisAPI.swift` | Watch-scoped API client and offline queue with idempotent `opId`s |
| `HealthSync.swift` | Optional HealthKit upload (steps, resting HR) – server rejects it unless Health is enabled in the Privacy Center |
| `JarvisComplication.swift` | WidgetKit complication: pending approvals / next task, refreshed every 15 min |

## Build
1. Xcode 15+ → File › New › Project › watchOS › App ("JarvisWatch"), SwiftUI, Swift.
2. Drag the four `.swift` files into the target (replace the generated App file). Add a Widget Extension target for `JarvisComplication.swift`.
3. Capabilities: HealthKit (read: steps, resting heart rate, sleep). Info.plist: `NSHealthShareUsageDescription`.
4. For a local server over plain HTTP add `NSAppTransportSecurity › NSAllowsLocalNetworking = YES`.
5. In the JARVIS web app: Device Center → register a `watchos` device, then set `jarvis.url` and `jarvis.token` (first-run settings or the paired iPhone app).

Platform limits respected: no background microphone, no continuous recording; voice input uses the system dictation sheet.
