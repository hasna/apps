import Foundation
import Combine

@MainActor
final class AppState: ObservableObject {
  private static let syncEveryPolls = 10

  @Published var today: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var week: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var month: CostSummary = CostSummary(total_usd: 0, sessions: 0, requests: 0, tokens: 0)
  @Published var dailyEntries: [DailyEntry] = []
  @Published var hourlyEntries: [HourlyEntry] = []
  @Published var topProjects: [ProjectStat] = []
  @Published var todayProjects: [ProjectStat] = []
  @Published var weekProjects: [ProjectStat] = []
  @Published var topAgents: [AgentStat] = []
  @Published var todayAgents: [AgentStat] = []
  @Published var weekAgents: [AgentStat] = []
  @Published var topAccounts: [AccountStat] = []
  @Published var todayAccounts: [AccountStat] = []
  @Published var weekAccounts: [AccountStat] = []
  @Published var subscriptionPlans: [SubscriptionPlan] = []
  @Published var recentSessions: [SessionStat] = []
  @Published var isOffline: Bool = false
  @Published var isSyncing: Bool = false
  @Published var lastUpdated: Date? = nil
  @Published var apiBaseURL: String = APIClient.storedBaseURL()
  @Published var sessionQuery: String = ""
  @Published var isEditingServer: Bool = false
  @Published var todaySavedUsd: Double = 0
  @Published var weekSavedUsd: Double = 0
  @Published var savedUsd: Double = 0
  @Published var quotaBadgePct: Double? = nil
  @Published var quotaBadgeLabel: String? = nil
  @Published var quotaSnapshots: [UsageSnapshot] = []
  @Published var machineCount: Int = 0
  @Published var fleetMachines: [FleetMachine] = []
  @Published var weekFleetMachines: [FleetMachine] = []
  @Published var currentMachine: String = ""
  @Published var selectedMachineID: String? = nil

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

  func setMachineFilter(_ machineID: String?) {
    selectedMachineID = machineID?.isEmpty == true ? nil : machineID
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
    let machine = selectedMachineID
    async let todayResult = try? await client.fetchSummary(period: "today", machine: machine)
    async let weekResult = try? await client.fetchSummary(period: "week", machine: machine)
    async let monthResult = try? await client.fetchSummary(period: "month", machine: machine)
    async let dailyResult = try? await client.fetchDaily(days: 14, machine: machine)
    async let hourlyResult = try? await client.fetchHourly(machine: machine)
    async let projectsResult = try? await client.fetchProjects(period: "month", machine: machine)
    async let todayProjectsResult = try? await client.fetchProjects(period: "today", machine: machine)
    async let weekProjectsResult = try? await client.fetchProjects(period: "week", machine: machine)
    async let agentsResult = try? await client.fetchAgents(period: "month", machine: machine)
    async let todayAgentsResult = try? await client.fetchAgents(period: "today", machine: machine)
    async let weekAgentsResult = try? await client.fetchAgents(period: "week", machine: machine)
    async let accountsResult = try? await client.fetchAccounts(period: "month", machine: machine)
    async let todayAccountsResult = try? await client.fetchAccounts(period: "today", machine: machine)
    async let weekAccountsResult = try? await client.fetchAccounts(period: "week", machine: machine)
    async let sessionsResult = try? await client.fetchSessions(search: sessionQuery, limit: sessionQuery.isEmpty ? 6 : 10, machine: machine)
    async let todaySavingsResult = try? await client.fetchSavings(period: "today")
    async let weekSavingsResult = try? await client.fetchSavings(period: "week")
    async let savingsResult = try? await client.fetchSavings(period: "month")
    async let usageResult = try? await client.fetchUsage()
    async let subscriptionsResult = try? await client.fetchSubscriptions()
    async let todayFleetResult = try? await client.fetchFleet(period: "today", machine: machine)
    async let weekFleetResult = try? await client.fetchFleet(period: "week", machine: machine)
    let (
      todaySummary, weekSummary, monthSummary, daily, hourly,
      projects, todayProjectsData, weekProjectsData,
      agents, todayAgentsData, weekAgentsData,
      accounts, todayAccountsData, weekAccountsData,
      sessions, todaySavings, weekSavings, savings, usage, subscriptions,
      todayFleet, weekFleet
    ) = await (
      todayResult, weekResult, monthResult, dailyResult, hourlyResult,
      projectsResult, todayProjectsResult, weekProjectsResult,
      agentsResult, todayAgentsResult, weekAgentsResult,
      accountsResult, todayAccountsResult, weekAccountsResult,
      sessionsResult, todaySavingsResult, weekSavingsResult, savingsResult, usageResult, subscriptionsResult,
      todayFleetResult, weekFleetResult
    )
    if let todayFleet {
      today = todayFleet.summary
      machineCount = todayFleet.machines.count
      fleetMachines = todayFleet.machines.sorted { $0.total_cost_usd > $1.total_cost_usd }
      currentMachine = todayFleet.current_machine
    } else if let todaySummary {
      today = todaySummary
    }
    if let weekFleet {
      week = weekFleet.summary
      weekFleetMachines = weekFleet.machines.sorted { $0.total_cost_usd > $1.total_cost_usd }
      if currentMachine.isEmpty { currentMachine = weekFleet.current_machine }
    } else if let weekSummary {
      week = weekSummary
    }
    if let monthSummary { month = monthSummary }
    if let daily { dailyEntries = daily }
    if let hourly { hourlyEntries = hourly }
    if let projects {
      let sorted = projects.sorted { $0.cost_usd > $1.cost_usd }
      topProjects = sorted.prefix(3).map { $0 }
    }
    if let todayProjectsData {
      let sorted = todayProjectsData.sorted { $0.cost_usd > $1.cost_usd }
      todayProjects = sorted.prefix(4).map { $0 }
    }
    if let weekProjectsData {
      let sorted = weekProjectsData.sorted { $0.cost_usd > $1.cost_usd }
      weekProjects = sorted.prefix(4).map { $0 }
    }
    if let agents {
      let sorted = agents.sorted { $0.api_equivalent_usd > $1.api_equivalent_usd }
      topAgents = sorted.prefix(4).map { $0 }
    }
    if let todayAgentsData {
      let sorted = todayAgentsData.sorted { $0.api_equivalent_usd > $1.api_equivalent_usd }
      todayAgents = sorted.prefix(4).map { $0 }
    }
    if let weekAgentsData {
      let sorted = weekAgentsData.sorted { $0.api_equivalent_usd > $1.api_equivalent_usd }
      weekAgents = sorted.prefix(4).map { $0 }
    }
    if let accounts {
      let sorted = accounts.sorted { $0.cost_usd > $1.cost_usd }
      topAccounts = sorted.prefix(3).map { $0 }
    }
    if let todayAccountsData {
      let sorted = todayAccountsData.sorted { $0.cost_usd > $1.cost_usd }
      todayAccounts = sorted.prefix(4).map { $0 }
    }
    if let weekAccountsData {
      let sorted = weekAccountsData.sorted { $0.cost_usd > $1.cost_usd }
      weekAccounts = sorted.prefix(4).map { $0 }
    }
    if let sessions { recentSessions = sessions }
    if let todaySavings { todaySavedUsd = todaySavings.saved_usd }
    if let weekSavings { weekSavedUsd = weekSavings.saved_usd }
    if let savings { savedUsd = savings.saved_usd }
    if let usage {
      let snapshots = usage.snapshots
      quotaSnapshots = Array(snapshots.prefix(8))
      if let badge = snapshots.first(where: { $0.unit == "percent" && $0.value > 0 }) {
        quotaBadgePct = badge.value
        quotaBadgeLabel = badge.displayAgent
      } else {
        quotaBadgePct = nil
        quotaBadgeLabel = nil
      }
    }
    if let subscriptions {
      subscriptionPlans = subscriptions
        .filter { $0.active != 0 }
        .sorted { $0.monthly_fee_usd > $1.monthly_fee_usd }
        .prefix(4)
        .map { $0 }
    }
    lastUpdated = Date()
  }
}
