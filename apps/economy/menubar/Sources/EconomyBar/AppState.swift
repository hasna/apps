import Foundation
import Combine

@MainActor
final class AppState: ObservableObject {
  @Published var today: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var month: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var dailyEntries: [DailyEntry] = []
  @Published var topProjects: [ProjectStat] = []
  @Published var isOffline: Bool = false
  @Published var isSyncing: Bool = false
  @Published var lastUpdated: Date? = nil

  private let client = APIClient()
  private var pollTask: Task<Void, Never>?

  func startPolling() {
    guard pollTask == nil else { return }
    pollTask = Task { [weak self] in
      while !Task.isCancelled {
        await self?.refresh()
        try? await Task.sleep(for: .seconds(30))
      }
    }
  }

  func stopPolling() {
    pollTask?.cancel()
    pollTask = nil
  }

  func syncNow() async {
    isSyncing = true
    do {
      try await client.sync()
      await refresh()
    } catch {}
    isSyncing = false
  }

  func refresh() async {
    let online = await client.isOnline()
    guard online else {
      isOffline = true
      return
    }
    isOffline = false
    async let todayResult = try? await client.fetchSummary(period: "today")
    async let monthResult = try? await client.fetchSummary(period: "month")
    async let dailyResult = try? await client.fetchDaily(days: 14)
    async let projectsResult = try? await client.fetchProjects()
    let (t, m, d, p) = await (todayResult, monthResult, dailyResult, projectsResult)
    if let t { today = t }
    if let m { month = m }
    if let d { dailyEntries = d }
    if let p {
      topProjects = p.sorted { $0.cost_usd > $1.cost_usd }.prefix(3).map { $0 }
    }
    lastUpdated = Date()
  }
}
