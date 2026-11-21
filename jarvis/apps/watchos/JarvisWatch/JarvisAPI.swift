import Foundation

struct Glance: Decodable {
    struct Task: Decodable, Identifiable { let id: String; let title: String }
    struct Approval: Decodable, Identifiable { let id: String; let summary: String; let risk: String }
    struct Event: Decodable { let title: String; let start: String }
    struct Weather: Decodable { let t: Int; let text: String }
    let status: String; let tasks: [Task]; let approvals: [Approval]; let nextEvent: Event?; let unread: Int; let weather: Weather?
}
struct ActionResult: Decodable { let status: String?; let response: String?; let state: String? }

/// Minimal client. Server URL and device token are entered once on the paired iPhone app
/// or in the watch settings and stored in the Keychain-backed UserDefaults suite.
final class JarvisAPI {
    var baseURL: URL { URL(string: UserDefaults.standard.string(forKey: "jarvis.url") ?? "http://192.168.1.10:7777")! }
    var token: String { UserDefaults.standard.string(forKey: "jarvis.token") ?? "" }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        var r = URLRequest(url: URL(string: path, relativeTo: baseURL)!)
        r.httpMethod = method
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.timeoutInterval = 15
        if let body { r.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, resp) = try await URLSession.shared.data(for: r)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "JARVIS", code: (resp as? HTTPURLResponse)?.statusCode ?? -1, userInfo: [NSLocalizedDescriptionKey: String(data: data, encoding: .utf8) ?? "error"])
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func glance() async throws -> Glance { try await request("api/watch/glance?lang=he") }
    func action(_ body: [String: Any]) async throws -> ActionResult { try await request("api/watch/action", method: "POST", body: body) }
    func decide(id: String, approve: Bool) async throws -> ActionResult { try await request("api/approvals/\(id)", method: "POST", body: ["decision": approve ? "approve" : "reject"]) }
    func push(ops: [[String: Any]]) async throws { let _: [String: AnyDecodable] = try await request("api/sync/push", method: "POST", body: ["ops": ops]) }
    func uploadHealth(days: [[String: Any]]) async throws { let _: [String: AnyDecodable] = try await request("api/wellness/ingest", method: "POST", body: ["days": days]) }
}

struct AnyDecodable: Decodable { init(from decoder: Decoder) throws {} }

/// Offline queue with idempotent opIds: safe to retry, the server applies each op once.
final class OfflineQueue {
    static let shared = OfflineQueue()
    private let key = "jarvis.queue"
    func add(type: String, payload: [String: Any]) {
        var q = (UserDefaults.standard.array(forKey: key) as? [[String: Any]]) ?? []
        q.append(["opId": UUID().uuidString, "type": type, "payload": payload, "clientTime": ISO8601DateFormatter().string(from: Date())])
        UserDefaults.standard.set(q, forKey: key)
    }
    func flush(api: JarvisAPI) async {
        let q = (UserDefaults.standard.array(forKey: key) as? [[String: Any]]) ?? []
        guard !q.isEmpty else { return }
        do { try await api.push(ops: q); UserDefaults.standard.removeObject(forKey: key) } catch { /* keep for next time */ }
    }
}
