import Foundation
import HealthKit

/// Optional HealthKit upload: steps, resting heart rate and sleep per day for the last 7 days.
/// Requires the user's HealthKit permission AND "Health data" enabled in the JARVIS Privacy
/// Center; the server rejects uploads otherwise. JARVIS only summarises trends, never diagnoses.
enum HealthSync {
    static let store = HKHealthStore()

    static func uploadLastWeek(api: JarvisAPI) async -> String {
        guard HKHealthStore.isHealthDataAvailable() else { return "HealthKit לא זמין" }
        let types: Set = [HKQuantityType(.stepCount), HKQuantityType(.restingHeartRate), HKCategoryType(.sleepAnalysis)]
        do { try await store.requestAuthorization(toShare: [], read: types) } catch { return "אין הרשאה" }
        var days: [[String: Any]] = []
        let cal = Calendar.current
        for offset in 0..<7 {
            let start = cal.startOfDay(for: cal.date(byAdding: .day, value: -offset, to: Date())!)
            let end = cal.date(byAdding: .day, value: 1, to: start)!
            var day: [String: Any] = ["date": ISO8601DateFormatter.dateOnly.string(from: start)]
            if let steps = await sum(.stepCount, unit: .count(), start, end) { day["steps"] = Int(steps) }
            if let hr = await average(.restingHeartRate, unit: HKUnit.count().unitDivided(by: .minute()), start, end) { day["restingHeartRate"] = Int(hr) }
            days.append(day)
        }
        do { try await api.uploadHealth(days: days); return "סונכרנו 7 ימים" } catch { return "השרת דחה (הפעילו בריאות במרכז הפרטיות)" }
    }

    private static func sum(_ id: HKQuantityTypeIdentifier, unit: HKUnit, _ s: Date, _ e: Date) async -> Double? {
        await withCheckedContinuation { c in
            let q = HKStatisticsQuery(quantityType: HKQuantityType(id), quantitySamplePredicate: HKQuery.predicateForSamples(withStart: s, end: e), options: .cumulativeSum) { _, r, _ in c.resume(returning: r?.sumQuantity()?.doubleValue(for: unit)) }
            store.execute(q)
        }
    }
    private static func average(_ id: HKQuantityTypeIdentifier, unit: HKUnit, _ s: Date, _ e: Date) async -> Double? {
        await withCheckedContinuation { c in
            let q = HKStatisticsQuery(quantityType: HKQuantityType(id), quantitySamplePredicate: HKQuery.predicateForSamples(withStart: s, end: e), options: .discreteAverage) { _, r, _ in c.resume(returning: r?.averageQuantity()?.doubleValue(for: unit)) }
            store.execute(q)
        }
    }
}

extension ISO8601DateFormatter {
    static let dateOnly: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]; return f }()
}
