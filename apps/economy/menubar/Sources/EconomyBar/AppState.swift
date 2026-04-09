import Foundation
import Combine

@MainActor
final class AppState: ObservableObject {
  private static let syncEveryPolls = 10

  @Published var today: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var week: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var month: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var dailyEntries: [DailyEntry] = []
  @Published var topProjects: [ProjectStat] = []
  @Published var recentSessions: [SessionStat] = []
  @Published var isOffline: Bool = false
  @Published var isSyncing: Bool = false
  @Published var lastUpdated: Date? = nil
  @Published var apiBaseURL: String = APIClient.storedBaseURL()
  @Published var sessionQuery: String = ""
  @Published var isEditingServer: Bool = false

  private let client = APIClient()
  private var pollTask: Task<Void, Never>?

  func startPolling() {
    guard pollTask == nil else { return }
    pollTask = Task { [weak self] in
      var pollCount = 0
      while !Task.isCancelled {
        guard let self else { return }
        if pollCount == 0 || pollCount % Self.syncEveryPolls == 0 {
          try? await self.client.sync()
        }
        await self.refresh()
        pollCount += 1
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

  func toggleServerEditor() {
    isEditingServer.toggle()
  }

  func cancelServerEditing() {
    isEditingServer = false
  }

  func saveAPIBaseURL(_ value: String) {
    Task { [weak self] in
      guard let self else { return }
      let normalized = await client.setBaseURL(value)
      await MainActor.run {
        self.apiBaseURL = normalized
        self.isEditingServer = false
      }
      await self.refresh()
    }
  }

  func setSessionQuery(_ query: String) {
    sessionQuery = query
    Task { [weak self] in
      await self?.refresh()
    }
  }

  func refresh() async {
    let online = await client.isOnline()
    guard online else {
      isOffline = true
      return
    }
    isOffline = false
    async let todayResult = try? await client.fetchSummary(period: "today")
    async let weekResult = try? await client.fetchSummary(period: "week")
    async let monthResult = try? await client.fetchSummary(period: "month")
    async let dailyResult = try? await client.fetchDaily(days: 14)
    async let projectsResult = try? await client.fetchProjects()
    async let sessionsResult = try? await client.fetchSessions(search: sessionQuery, limit: sessionQuery.isEmpty ? 6 : 10)
    let (todaySummary, weekSummary, monthSummary, daily, projects, sessions) = await (todayResult, weekResult, monthResult, dailyResult, projectsResult, sessionsResult)
    if let todaySummary { today = todaySummary }
    if let weekSummary { week = weekSummary }
    if let monthSummary { month = monthSummary }
    if let daily { dailyEntries = daily }
    if let projects {
      let sorted = projects.sorted { $0.cost_usd > $1.cost_usd }
      topProjects = sorted.prefix(3).map { $0 }
    }
    if let sessions { recentSessions = sessions }
    lastUpdated = Date()
  }
}
