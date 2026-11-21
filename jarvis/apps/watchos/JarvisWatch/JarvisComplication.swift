import WidgetKit
import SwiftUI

/// Watch-face complication (WidgetKit): shows the pending-approval count or the next task.
/// Refreshes every 15 minutes to stay battery friendly.
struct JarvisEntry: TimelineEntry { let date: Date; let approvals: Int; let next: String }

struct JarvisProvider: TimelineProvider {
    func placeholder(in context: Context) -> JarvisEntry { .init(date: .now, approvals: 0, next: "JARVIS") }
    func getSnapshot(in context: Context, completion: @escaping (JarvisEntry) -> Void) { completion(placeholder(in: context)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<JarvisEntry>) -> Void) {
        Task {
            let g = try? await JarvisAPI().glance()
            let e = JarvisEntry(date: .now, approvals: g?.approvals.count ?? 0, next: g?.tasks.first?.title ?? "—")
            completion(Timeline(entries: [e], policy: .after(.now.addingTimeInterval(15 * 60))))
        }
    }
}

struct JarvisComplicationView: View {
    let entry: JarvisEntry
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Image(systemName: entry.approvals > 0 ? "exclamationmark.shield.fill" : "circle.hexagongrid.fill").foregroundStyle(entry.approvals > 0 ? .orange : .cyan)
                Text(entry.approvals > 0 ? "\(entry.approvals)" : "J").font(.caption2).bold()
            }
        }
    }
}

struct JarvisComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "JarvisComplication", provider: JarvisProvider()) { JarvisComplicationView(entry: $0) }
            .configurationDisplayName("JARVIS").description("אישורים ממתינים והמשימה הבאה")
            .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline])
    }
}
