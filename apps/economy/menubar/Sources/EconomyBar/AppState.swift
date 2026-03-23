import Foundation
import Combine

@MainActor
final class AppState: ObservableObject {
  @Published var today: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var yesterday: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var month: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var year: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var dailyEntries: [DailyEntry] = []
  @Published var topProjects: [ProjectStat] = []
  @Published var allProjects: [ProjectStat] = []
  @Published var goals: [GoalStatus] = []
  @Published var isOffline: Bool = false
  @Published var isSyncing: Bool = false
  @Published var lastUpdated: Date? = nil

  private let client = APIClient()
  private var pollTask: Task<Void, Never>?

  func startPolling() {
    guard pollTask == nil else { return }
    pollTask = Task { [weak self] in
      while !Task.isCancelled {
        // Silent sync + refresh (no isSyncing spinner)
        try? await self?.client.sync()
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
    async let yesterdayResult = try? await client.fetchSummary(period: "yesterday")
    async let monthResult = try? await client.fetchSummary(period: "month")
    async let yearResult = try? await client.fetchSummary(period: "year")
    async let dailyResult = try? await client.fetchDaily(days: 14)
    async let projectsResult = try? await client.fetchProjects()
    async let goalsResult = try? await client.fetchGoals()
    let (t, yt, m, y, d, p, g) = await (todayResult, yesterdayResult, monthResult, yearResult, dailyResult, projectsResult, goalsResult)
    if let t { today = t }
    if let yt { yesterday = yt }
    if let m { month = m }
    if let y { year = y }
    if let d { dailyEntries = d }
    if let p {
      let sorted = p.sorted { $0.cost_usd > $1.cost_usd }
      allProjects = sorted
      topProjects = sorted.prefix(3).map { $0 }
    }
    if let g { goals = g }
    lastUpdated = Date()
  }
}
