// JARVIS for Apple Watch (watchOS 10+, SwiftUI).
// Glanceable status, dictation-based questions, quick actions, approvals and an optional
// HealthKit daily summary upload. Talks to the JARVIS server with a watch-scoped device token,
// which can only reach /api/watch, /api/command, /api/approvals, /api/sync and /api/wellness.
import SwiftUI

@main
struct JarvisWatchApp: App {
    @StateObject private var model = JarvisModel()
    var body: some Scene {
        WindowGroup {
            NavigationStack { HomeView().environmentObject(model) }
        }
    }
}

@MainActor
final class JarvisModel: ObservableObject {
    @Published var glance: Glance?
    @Published var error: String?
    @Published var lastAnswer: String?
    let api = JarvisAPI()

    func refresh() async {
        do { glance = try await api.glance(); error = nil }
        catch { self.error = error.localizedDescription }
    }

    func ask(_ text: String) async {
        do { lastAnswer = try await api.action(["action": "ask", "text": text]).response ?? "—" }
        catch {
            // Offline: queue it and tell the user honestly.
            OfflineQueue.shared.add(type: "command", payload: ["text": text])
            lastAnswer = "אין חיבור. נשמר ויישלח אחר כך."
        }
    }

    func quick(_ action: String, text: String = "", extra: [String: Any] = [:]) async -> String {
        var body: [String: Any] = ["action": action, "text": text, "opId": UUID().uuidString, "clientTime": ISO8601DateFormatter().string(from: Date())]
        extra.forEach { body[$0.key] = $0.value }
        do { let r = try await api.action(body); await refresh(); return r.status ?? "ok" }
        catch { return "שגיאה: \(error.localizedDescription)" }
    }

    func decide(_ id: String, approve: Bool) async -> String {
        do { let r = try await api.decide(id: id, approve: approve); await refresh(); return r.response ?? r.state ?? "" }
        catch { return error.localizedDescription }
    }
}

struct HomeView: View {
    @EnvironmentObject var model: JarvisModel
    @State private var dictation = ""
    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                CoreRing(state: model.glance?.status ?? "idle").frame(width: 92, height: 92)
                if let w = model.glance?.weather { Text("\(w.t)° \(w.text)").font(.caption2).foregroundStyle(.secondary) }
                // Dictation: watchOS shows the system speech-to-text sheet for TextField input.
                TextField("שאל את ג׳ארוויס", text: $dictation)
                    .onSubmit { let q = dictation; dictation = ""; Task { await model.ask(q) } }
                if let a = model.lastAnswer { Text(a).font(.footnote).multilineTextAlignment(.leading) }
                if let ap = model.glance?.approvals, !ap.isEmpty {
                    NavigationLink { ApprovalsView() } label: { Label("\(ap.count) אישורים", systemImage: "exclamationmark.shield").foregroundStyle(.orange) }
                }
                if let e = model.glance?.nextEvent { InfoRow(icon: "calendar", text: e.title) }
                ForEach(model.glance?.tasks ?? []) { t in
                    Button { Task { _ = await model.quick("complete_task", extra: ["id": t.id]) } } label: { InfoRow(icon: "circle", text: t.title) }.buttonStyle(.plain)
                }
                NavigationLink { QuickActionsView() } label: { Label("פעולות מהירות", systemImage: "bolt.fill") }
                if let err = model.error { Text(err).font(.caption2).foregroundStyle(.red) }
            }.padding(.horizontal, 4)
        }
        .task { await model.refresh(); await OfflineQueue.shared.flush(api: model.api) }
        .refreshable { await model.refresh() }
        .navigationTitle("JARVIS")
    }
}

struct QuickActionsView: View {
    @EnvironmentObject var model: JarvisModel
    @State private var text = ""
    @State private var result = ""
    var body: some View {
        List {
            TextField("טקסט", text: $text)
            Button("תזכורת") { Task { result = await model.quick("add_reminder", text: text) } }
            Button("משימה") { Task { result = await model.quick("add_task", text: text) } }
            Button("לרשימת קניות") { Task { result = await model.quick("shopping_add", text: text) } }
            Button("פתק קולי") { Task { result = await model.quick("voice_note", text: text) } }
            Button("טיימר 5 דק׳") { Task { result = await model.quick("timer", extra: ["minutes": 5]) } }
            Button("מצא את הטלפון") { Task { result = await model.quick("find_phone") } }
            Button("סנכרון בריאות") { Task { result = await HealthSync.uploadLastWeek(api: model.api) } }
            if !result.isEmpty { Text(result).font(.caption2) }
        }
    }
}

struct ApprovalsView: View {
    @EnvironmentObject var model: JarvisModel
    @State private var result = ""
    var body: some View {
        List(model.glance?.approvals ?? []) { a in
            VStack(alignment: .leading, spacing: 6) {
                Text(a.summary).font(.footnote)
                Text(a.risk).font(.caption2).foregroundStyle(.orange)
                HStack {
                    Button("אשר") { Task { result = await model.decide(a.id, approve: true) } }.tint(.green)
                    Button("דחה") { Task { result = await model.decide(a.id, approve: false) } }.tint(.red)
                }
            }
        }
        .overlay(alignment: .bottom) { if !result.isEmpty { Text(result).font(.caption2).padding(4) } }
    }
}

struct InfoRow: View {
    let icon: String; let text: String
    var body: some View { HStack { Image(systemName: icon).foregroundStyle(.cyan); Text(text).font(.footnote).lineLimit(2); Spacer() } }
}

/// Animated energy ring. Colour follows the JARVIS state.
struct CoreRing: View {
    let state: String
    @State private var spin = false
    var color: Color { state == "approval" ? .orange : .cyan }
    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.25), lineWidth: 2)
            Circle().trim(from: 0, to: 0.3).stroke(color, style: StrokeStyle(lineWidth: 3, lineCap: .round)).rotationEffect(.degrees(spin ? 360 : 0))
            Circle().fill(RadialGradient(colors: [.white, color.opacity(0.6), .clear], center: .center, startRadius: 2, endRadius: 34)).padding(14)
            Text("JARVIS").font(.system(size: 10, weight: .heavy)).tracking(2)
        }
        .onAppear { withAnimation(.linear(duration: 6).repeatForever(autoreverses: false)) { spin = true } }
    }
}
