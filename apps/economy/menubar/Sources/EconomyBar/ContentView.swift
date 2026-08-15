import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

private enum WorkPeriod: String, CaseIterable, Identifiable {
  case today
  case week

  var id: String { rawValue }

  static var initial: WorkPeriod {
    ProcessInfo.processInfo.environment["ECONOMYBAR_PERIOD"] == "week" ? .week : .today
  }

  var title: String {
    switch self {
    case .today: return "Today"
    case .week: return "This week"
    }
  }

  var sectionSuffix: String {
    switch self {
    case .today: return "today"
    case .week: return "this week"
    }
  }
}

private enum MenuScreen {
  case work
  case sections

  static var initial: MenuScreen {
    ProcessInfo.processInfo.environment["ECONOMYBAR_SCREEN"] == "sections" ? .sections : .work
  }
}

private enum WorkTab: String, CaseIterable, Identifiable {
  case all
  case recent
  case projects
  case machines
  case accounts
  case agents
  case stats

  var id: String { rawValue }

  var title: String {
    switch self {
    case .all: return "All"
    case .recent: return "Recent"
    case .projects: return "Projects"
    case .machines: return "Machines"
    case .accounts: return "Accounts"
    case .agents: return "Agents"
    case .stats: return "Stats"
    }
  }
}

private enum ManageSectionGroupKind: String, CaseIterable, Identifiable {
  case overview
  case work
  case savings

  var id: String { rawValue }

  var title: String {
    switch self {
    case .overview: return "OVERVIEW"
    case .work: return "WORK"
    case .savings: return "SAVINGS"
    }
  }
}

private enum ManageSectionID: String, CaseIterable, Identifiable {
  case workStats
  case activity
  case workDetails
  case machines
  case agents
  case projects
  case recentWork
  case accounts
  case usageLimits
  case subscriptions
  case savings

  var id: String { rawValue }

  var group: ManageSectionGroupKind {
    switch self {
    case .workStats, .activity, .workDetails, .machines, .agents:
      return .overview
    case .projects, .recentWork, .accounts:
      return .work
    case .usageLimits, .subscriptions, .savings:
      return .savings
    }
  }

  var title: String {
    switch self {
    case .workStats: return "Work stats"
    case .activity: return "Activity"
    case .workDetails: return "Work details"
    case .machines: return "Machines"
    case .agents: return "Agents"
    case .projects: return "Projects"
    case .recentWork: return "Recent work"
    case .accounts: return "Accounts"
    case .usageLimits: return "Usage limits"
    case .subscriptions: return "Subscriptions"
    case .savings: return "Savings"
    }
  }

  var icon: String {
    switch self {
    case .workStats: return "chart.bar.xaxis"
    case .activity: return "waveform.path.ecg"
    case .workDetails: return "target"
    case .machines: return "desktopcomputer"
    case .agents: return "cpu"
    case .projects: return "folder"
    case .recentWork: return "rectangle.stack"
    case .accounts: return "person.crop.circle"
    case .usageLimits: return "gauge.with.dots.needle.33percent"
    case .subscriptions: return "creditcard"
    case .savings: return "banknote"
    }
  }

  var tint: Color {
    switch self {
    case .workStats, .savings: return .green
    case .activity: return .mint
    case .workDetails, .machines: return .blue
    case .agents: return .orange
    case .projects: return .yellow
    case .recentWork: return .purple
    case .accounts: return .pink
    case .usageLimits: return .secondary
    case .subscriptions: return .indigo
    }
  }
}

private struct ManageSectionItem: Identifiable {
  let id: ManageSectionID
  var isDefault: Bool
  var showsBadge: Bool
  var isVisible: Bool
  var isCollapsed: Bool

  var group: ManageSectionGroupKind { id.group }

  init(
    id: ManageSectionID,
    isDefault: Bool = false,
    showsBadge: Bool = false,
    isVisible: Bool = true,
    isCollapsed: Bool = false
  ) {
    self.id = id
    self.isDefault = isDefault
    self.showsBadge = showsBadge
    self.isVisible = isVisible
    self.isCollapsed = isCollapsed
  }

  static let defaults: [ManageSectionItem] = [
    ManageSectionItem(id: .workStats, isDefault: true, showsBadge: true),
    ManageSectionItem(id: .activity, isDefault: true),
    ManageSectionItem(id: .workDetails, isDefault: true),
    ManageSectionItem(id: .machines, showsBadge: true),
    ManageSectionItem(id: .agents, showsBadge: true),
    ManageSectionItem(id: .projects, isDefault: true),
    ManageSectionItem(id: .accounts),
    ManageSectionItem(id: .usageLimits, showsBadge: true),
    ManageSectionItem(id: .subscriptions, isVisible: false, isCollapsed: true),
    ManageSectionItem(id: .savings),
  ]
}

private var adaptiveSubtleFill: Color {
  Color.primary.opacity(0.025)
}

private var adaptiveControlFill: Color {
  Color.primary.opacity(0.045)
}

private var adaptiveBadgeFill: Color {
  Color.primary.opacity(0.075)
}

private var adaptiveSelectedFill: Color {
  Color.primary.opacity(0.10)
}

private struct ActivityBarEntry {
  let label: String
  let valueLabel: String
  let cost: Double
}

struct ContentView: View {
  @EnvironmentObject var appState: AppState
  @Environment(\.openURL) private var openURL
  @State private var draftAPIBaseURL: String = ""
  @State private var selectedPeriod: WorkPeriod = WorkPeriod.initial
  @State private var selectedScreen: MenuScreen = MenuScreen.initial
  @State private var selectedTab: WorkTab = .all
  @State private var manageSections: [ManageSectionItem] = ManageSectionItem.defaults
  @State private var draggingSection: ManageSectionID?

  private var lastUpdatedText: String {
    guard let date = appState.lastUpdated else { return "Never" }
    let seconds = Int(-date.timeIntervalSinceNow)
    if seconds < 60 { return "\(seconds)s ago" }
    return "\(seconds / 60)m ago"
  }

  private var selectedSummary: CostSummary {
    selectedPeriod == .today ? appState.today : appState.week
  }

  private var periodMachines: [FleetMachine] {
    selectedPeriod == .today ? appState.fleetMachines : appState.weekFleetMachines
  }

  private var selectedMachines: [FleetMachine] {
    guard let selectedMachineID = appState.selectedMachineID else { return periodMachines }
    return periodMachines.filter { $0.machine_id == selectedMachineID }
  }

  private var machineOptions: [String] {
    var seen = Set<String>()
    var machines: [String] = []

    for machine in (appState.allMachines + appState.fleetMachines + appState.weekFleetMachines).map(\.machine_id) {
      if !machine.isEmpty && seen.insert(machine).inserted {
        machines.append(machine)
      }
    }

    if !appState.currentMachine.isEmpty && seen.insert(appState.currentMachine).inserted {
      machines.append(appState.currentMachine)
    }

    return machines.sorted()
  }

  private var selectedAgents: [AgentStat] {
    selectedPeriod == .today ? appState.todayAgents : appState.weekAgents
  }

  private var selectedProjects: [ProjectStat] {
    selectedPeriod == .today ? appState.todayProjects : appState.weekProjects
  }

  private var selectedAccounts: [AccountStat] {
    selectedPeriod == .today ? appState.todayAccounts : appState.weekAccounts
  }

  private var selectedSavedUsd: Double {
    selectedPeriod == .today ? appState.todaySavedUsd : appState.weekSavedUsd
  }

  private var topMachine: FleetMachine? {
    selectedMachines.first
  }

  private var topAgent: AgentStat? {
    selectedAgents.first
  }

  private var topProject: ProjectStat? {
    selectedProjects.first
  }

  private var averageDaySpend: Double {
    guard appState.week.total_usd > 0 else { return 0 }
    return appState.week.total_usd / 7
  }

  private var activityBars: [ActivityBarEntry] {
    switch selectedPeriod {
    case .today:
      let costsByHour = Dictionary(grouping: appState.hourlyEntries, by: \.hour)
        .mapValues { entries in entries.reduce(0) { $0 + $1.cost_usd } }
      let currentHour = currentUTCHour()

      return (0..<12).map { offset in
        let hour = (currentHour - 11 + offset + 24) % 24
        let key = String(format: "%02d", hour)
        let cost = costsByHour[key] ?? 0
        return ActivityBarEntry(label: activityHourLabel(key), valueLabel: activityValue(cost), cost: cost)
      }
    case .week:
      let grouped = Dictionary(grouping: appState.dailyEntries, by: \.date)
      let entries = grouped.keys.sorted().compactMap { date -> ActivityBarEntry? in
        let cost = grouped[date]?.reduce(0) { $0 + $1.cost_usd } ?? 0
        return ActivityBarEntry(label: activityDateLabel(date), valueLabel: activityValue(cost), cost: cost)
      }
      return Array(entries.suffix(7))
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      switch selectedScreen {
      case .work:
        topNavigation
        Divider()
        workScreen
      case .sections:
        sectionsHeader
        Divider()
        sectionsScreen
      }

      Divider()
      footer
    }
    .frame(width: 416, height: 660)
    .background(.ultraThinMaterial)
    .onAppear {
      draftAPIBaseURL = appState.apiBaseURL
    }
    .onChange(of: appState.apiBaseURL) { _, newValue in
      draftAPIBaseURL = newValue
    }
  }

  private var topNavigation: some View {
    HStack(spacing: 8) {
      MachineFilterMenu(
        selectedMachineID: appState.selectedMachineID,
        currentMachine: appState.currentMachine,
        machines: machineOptions,
        onSelect: appState.setMachineFilter
      )
      .layoutPriority(1)

      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 4) {
          ForEach(WorkTab.allCases) { tab in
            Button {
              selectedTab = tab
            } label: {
              TopNavItem(
                title: tab.title,
                badge: tabBadge(tab),
                selected: selectedTab == tab
              )
            }
            .buttonStyle(.plain)
            .help(tab.title)
          }
        }
        .padding(2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .frame(height: 32)
      .nativeGlassSurface(cornerRadius: 12, material: .ultraThinMaterial, shadow: false)

      HStack(spacing: 4) {
        Button(action: openDashboard) {
          Image(systemName: "ellipsis")
            .font(.system(size: 13, weight: .medium))
            .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .help("Open web app")

        Button(action: openSections) {
          Image(systemName: "gearshape")
            .font(.system(size: 14, weight: .regular))
            .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .help("Manage sections")
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }

  private var workScreen: some View {
    Group {
      if appState.isOffline {
        OfflineView(baseURL: appState.apiBaseURL)
          .padding(16)
      } else {
        ScrollView(.vertical, showsIndicators: false) {
          VStack(alignment: .leading, spacing: 10) {
            workHeader
            workTabContent
          }
          .padding(16)
        }
        .clipped()
      }
    }
  }

  @ViewBuilder
  private var workTabContent: some View {
    switch selectedTab {
    case .all:
      managedWorkSections([
        .workStats,
        .activity,
        .workDetails,
        .machines,
        .agents,
        .projects,
        .accounts,
        .usageLimits,
        .subscriptions,
        .savings,
      ])
    case .recent:
      sessionsCard
    case .projects:
      managedWorkSections([.workDetails, .projects, .accounts])
    case .machines:
      managedWorkSections([.machines, .workDetails])
    case .accounts:
      managedWorkSections([.accounts, .workDetails])
    case .agents:
      managedWorkSections([.agents])
    case .stats:
      managedWorkSections([.workStats, .activity, .workDetails])
    }
  }

  @ViewBuilder
  private func managedWorkSections(_ allowedIDs: [ManageSectionID]) -> some View {
    let sectionIDs = orderedVisibleContentIDs(matching: allowedIDs)

    if sectionIDs.isEmpty {
      noVisibleSectionsCard
    } else {
      ForEach(sectionIDs, id: \.self) { sectionID in
        managedWorkSection(sectionID)
      }
    }
  }

  @ViewBuilder
  private func managedWorkSection(_ sectionID: ManageSectionID) -> some View {
    if let item = manageSections.first(where: { $0.id == sectionID }), item.isCollapsed {
      CollapsedSectionCard(title: sectionID.title, icon: sectionID.icon, tint: sectionTint(for: sectionID))
    } else {
      switch sectionID {
      case .workStats:
        statsGrid
      case .activity:
        activityCard
      case .workDetails:
        workDetailsCard
      case .machines:
        machinesCard
      case .agents:
        agentsCard
      case .projects:
        projectsCard
      case .recentWork:
        sessionsCard
      case .accounts:
        accountsCard
      case .usageLimits:
        usageLimitsCard
      case .subscriptions:
        subscriptionsCard
      case .savings:
        savingsCard
      }
    }
  }

  private func orderedVisibleContentIDs(matching allowedIDs: [ManageSectionID]) -> [ManageSectionID] {
    let allowedSet = Set(allowedIDs)
    return manageSections
      .filter { allowedSet.contains($0.id) && $0.isVisible }
      .map(\.id)
  }

  private var noVisibleSectionsCard: some View {
    GlassCard {
      EmptySectionRow(icon: "eye.slash", text: "No visible sections in this tab")
    }
  }

  private func tabBadge(_ tab: WorkTab) -> Int? {
    switch tab {
    case .all:
      return max(appState.machineCount, selectedMachines.count)
    case .recent:
      return appState.recentSessions.count
    case .projects:
      return selectedProjects.count
    case .machines:
      return selectedMachines.count
    case .accounts:
      return selectedAccounts.count
    case .agents:
      return selectedAgents.count
    case .stats:
      return nil
    }
  }

  private var workHeader: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center) {
        StatusPill(
          icon: "clock",
          text: lastUpdatedText,
          tint: .secondary
        )
        if let quota = appState.quotaBadgePct {
          StatusPill(
            icon: quota >= 80 ? "exclamationmark.circle" : "gauge.with.dots.needle.33percent",
            text: String(format: "%.0f%% quota", quota),
            tint: quota >= 80 ? .orange : .green
          )
        }

        Spacer()

        PeriodSegmentedControl(selection: $selectedPeriod)
      }

      Button(action: openDashboard) {
        Label("Open web app", systemImage: "arrow.up.right.square")
          .font(.system(size: 11, weight: .regular))
      }
      .buttonStyle(.plain)
      .foregroundStyle(.blue)
    }
  }

  private var statsGrid: some View {
    LazyVGrid(
      columns: [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10),
      ],
      spacing: 10
    ) {
      StatTile(
        icon: "dollarsign",
        tint: .green,
        title: "SPEND",
        value: formatCost(selectedSummary.total_usd),
        detail: selectedSavedUsd > 0 ? "\(formatCost(selectedSavedUsd)) saved" : nil,
        trendIcon: spendTrendIcon,
        trendColor: spendTrendColor
      )

      StatTile(
        icon: "rectangle.stack",
        tint: .blue,
        title: "SESSIONS",
        value: "\(selectedSummary.sessions)",
        trend: selectedPeriod == .today ? "active today" : "week total",
        trendColor: .secondary
      )

      StatTile(
        icon: "arrow.left.arrow.right",
        tint: .indigo,
        title: "REQUESTS",
        value: formatCount(selectedSummary.requests),
        trend: "\(selectedMachines.count) machines",
        trendColor: .green
      )

      StatTile(
        icon: "sum",
        tint: .teal,
        title: "TOKENS",
        value: formatTokens(selectedSummary.tokens),
        trend: selectedPeriod.title,
        trendColor: .secondary
      )
    }
  }

  private var activityCard: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          Text("Activity")
            .font(.system(size: 13, weight: .medium))
          Spacer()
          Text(selectedPeriod == .today ? "Last 12 hours" : "Last 7 days")
            .font(.system(size: 11, weight: .regular))
            .foregroundStyle(.secondary)
        }

        ActivityBars(entries: activityBars)
      }
    }
  }

  private func workSectionHeader(title: String, subtitle: String) -> some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(size: 13, weight: .medium))
        Text(subtitle)
          .font(.system(size: 11, weight: .regular))
          .foregroundStyle(.secondary)
      }

      Spacer()

      Text(selectedPeriod.title)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(.blue)
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(.blue.opacity(0.12), in: Capsule())
    }
  }

  private var workDetailsCard: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 10) {
        workSectionHeader(
          title: "Work details",
          subtitle: selectedPeriod == .today ? "Current pace for today" : "Current pace this week"
        )

        HStack(alignment: .top, spacing: 14) {
          WorkDetailTextMetric(label: "Machine", value: topMachine?.displayName ?? "None")
          WorkDetailTextMetric(label: "Agent", value: topAgent?.displayName ?? "None")
          WorkDetailTextMetric(label: "Project", value: topProject?.displayName ?? "None")
        }

        Text("\(selectedSummary.sessions) sessions / \(formatCount(selectedSummary.requests)) requests / \(formatTokens(selectedSummary.tokens)) tokens")
          .font(.system(size: 11, weight: .regular).monospacedDigit())
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .minimumScaleFactor(0.75)
      }
    }
  }

  private var machinesCard: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 10) {
        workSectionHeader(
          title: "Machines",
          subtitle: "\(selectedMachines.count) active \(selectedPeriod.sectionSuffix)"
        )

        VStack(alignment: .leading, spacing: 0) {
          if selectedMachines.isEmpty {
            EmptySectionRow(icon: "server.rack", text: "No machine work \(selectedPeriod.sectionSuffix)")
          } else {
            ForEach(Array(selectedMachines.prefix(5).enumerated()), id: \.element.machine_id) { index, machine in
              if index > 0 { Divider().opacity(0.55) }
              EconomyMachineRow(machine: machine, currentMachine: appState.currentMachine)
                .padding(.vertical, 8)
            }
          }
        }
      }
    }
  }

  private var agentsCard: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 10) {
        workSectionHeader(
          title: "Agents",
          subtitle: "\(selectedAgents.count) agents with synced work"
        )

        VStack(alignment: .leading, spacing: 0) {
          if selectedAgents.isEmpty {
            EmptySectionRow(icon: "cpu", text: "No agent work \(selectedPeriod.sectionSuffix)")
          } else {
            ForEach(Array(selectedAgents.prefix(4).enumerated()), id: \.element.id) { index, agent in
              if index > 0 { Divider().opacity(0.55) }
              EconomyAgentRow(agent: agent)
                .padding(.vertical, 8)
            }
          }
        }
      }
    }
  }

  private var projectsCard: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 10) {
        workSectionHeader(
          title: "Projects",
          subtitle: "\(selectedProjects.count) projects in the selected period"
        )

        VStack(alignment: .leading, spacing: 0) {
          if selectedProjects.isEmpty {
            EmptySectionRow(icon: "folder", text: "No project work \(selectedPeriod.sectionSuffix)")
          } else {
            ForEach(Array(selectedProjects.prefix(4).enumerated()), id: \.offset) { index, project in
              if index > 0 { Divider().opacity(0.55) }
              EconomyProjectRow(project: project)
                .padding(.vertical, 8)
            }
          }
        }
      }
    }
  }

  private var sessionsCard: some View {
    SectionGlassCard(
      title: appState.sessionQuery.isEmpty ? "RECENT WORK" : "SESSION SEARCH",
      badge: appState.recentSessions.count,
      actionTitle: nil
    ) {
      TextField(
        "Search sessions or projects",
        text: Binding(
          get: { appState.sessionQuery },
          set: { appState.setSessionQuery($0) }
        )
      )
      .textFieldStyle(.roundedBorder)
      .padding(.horizontal, 12)
      .padding(.vertical, 10)

      if appState.recentSessions.isEmpty {
        Divider().opacity(0.55)
        EmptySectionRow(
          icon: "magnifyingglass",
          text: appState.sessionQuery.isEmpty ? "No sessions synced yet" : "No matching sessions"
        )
      } else {
        ForEach(Array(appState.recentSessions.prefix(5).enumerated()), id: \.element.id) { index, session in
          Divider().opacity(0.55)
          EconomySessionRow(session: session)
        }
      }
    }
  }

  private var accountsCard: some View {
    SectionGlassCard(
      title: "ACCOUNTS",
      badge: selectedAccounts.count,
      actionTitle: selectedPeriod.title
    ) {
      if selectedAccounts.isEmpty {
        EmptySectionRow(icon: "person.crop.circle", text: "No account rollups synced yet")
      } else {
        ForEach(Array(selectedAccounts.prefix(4).enumerated()), id: \.element.id) { index, account in
          if index > 0 { Divider().opacity(0.55) }
          AccountRowView(account: account)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
      }
    }
  }

  private var usageLimitsCard: some View {
    SectionGlassCard(
      title: "USAGE LIMITS",
      badge: appState.quotaSnapshots.count,
      actionTitle: nil
    ) {
      if appState.quotaSnapshots.isEmpty {
        EmptySectionRow(icon: "gauge.with.dots.needle.33percent", text: "No usage snapshots synced yet")
      } else {
        ForEach(Array(appState.quotaSnapshots.prefix(4).enumerated()), id: \.element.id) { index, snapshot in
          if index > 0 { Divider().opacity(0.55) }
          UsageSnapshotRowView(snapshot: snapshot)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
      }
    }
  }

  private var subscriptionsCard: some View {
    SectionGlassCard(
      title: "SUBSCRIPTIONS",
      badge: appState.subscriptionPlans.count,
      actionTitle: nil
    ) {
      if appState.subscriptionPlans.isEmpty {
        EmptySectionRow(icon: "creditcard", text: "No active subscriptions synced yet")
      } else {
        ForEach(Array(appState.subscriptionPlans.prefix(4).enumerated()), id: \.element.id) { index, subscription in
          if index > 0 { Divider().opacity(0.55) }
          SubscriptionRowView(subscription: subscription)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
      }
    }
  }

  private var savingsCard: some View {
    SectionGlassCard(
      title: "SAVINGS",
      badge: nil,
      actionTitle: nil
    ) {
      CompactSignalRow(
        icon: "banknote",
        title: "Saved versus API",
        value: formatCost(appState.savedUsd),
        subtitle: "Subscription included usage",
        tint: .green
      )
      Divider().opacity(0.55)
      CompactSignalRow(
        icon: "creditcard",
        title: "Active plans",
        value: "\(appState.subscriptionPlans.count)",
        subtitle: "Configured subscription plans",
        tint: .indigo
      )
    }
  }

  private var sectionsHeader: some View {
    HStack(spacing: 10) {
      Button(action: closeSections) {
        Image(systemName: "chevron.left")
          .font(.system(size: 13, weight: .semibold))
          .frame(width: 28, height: 28)
      }
      .buttonStyle(.plain)
      .help("Back")

      VStack(alignment: .leading, spacing: 2) {
        Text("Manage sections")
          .font(.system(size: 13, weight: .medium))
        Text("Create and edit sections")
          .font(.system(size: 11, weight: .regular))
          .foregroundStyle(.secondary)
      }

      Spacer()

      Button(action: openDashboard) {
        Image(systemName: "ellipsis")
          .font(.system(size: 13, weight: .medium))
          .frame(width: 28, height: 28)
      }
      .buttonStyle(.plain)
      .help("Open web app")
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }

  private var sectionsScreen: some View {
    ScrollView(.vertical, showsIndicators: false) {
      VStack(alignment: .leading, spacing: 14) {
        ForEach(ManageSectionGroupKind.allCases) { group in
          ManageSectionsGroup(
            title: group.title,
            badge: manageSections.filter { $0.group == group }.count,
            actionTitle: "Reset",
            action: { resetSectionGroup(group) }
          ) {
            manageSectionRows(for: group)
          }
        }

        ManageSectionsGroup(title: "SETTINGS", badge: nil, actionTitle: nil, action: nil) {
          ServerSettingsRow(baseURL: appState.apiBaseURL, isEditing: appState.isEditingServer, action: toggleServerEditor)

          if appState.isEditingServer {
            Divider().opacity(0.55)
            compactServerEditor
          }
        }
      }
      .padding(16)
    }
    .clipped()
  }

  @ViewBuilder
  private func manageSectionRows(for group: ManageSectionGroupKind) -> some View {
    let rows = manageSections.filter { $0.group == group }

    ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
      if index > 0 {
        Divider().opacity(0.55)
      }

      ManageSectionRow(
        item: item,
        subtitle: manageSubtitle(for: item.id),
        chips: manageChips(for: item),
        tint: sectionTint(for: item.id),
        isDragging: draggingSection == item.id,
        onToggleVisible: { toggleSectionVisible(item.id) },
        onToggleCollapsed: { toggleSectionCollapsed(item.id) },
        onReset: { resetSection(item.id) }
      )
      .onDrag {
        draggingSection = item.id
        return NSItemProvider(object: item.id.rawValue as NSString)
      }
      .onDrop(
        of: [UTType.text],
        delegate: ManageSectionDropDelegate(
          target: item.id,
          sections: $manageSections,
          draggingSection: $draggingSection
        )
      )
    }
  }

  private var compactServerEditor: some View {
    VStack(alignment: .leading, spacing: 8) {
      TextField("Server URL", text: $draftAPIBaseURL)
        .textFieldStyle(.roundedBorder)
        .font(.system(size: 12, weight: .regular))
        .onSubmit(saveServerURL)

      HStack(spacing: 8) {
        Button("Save", action: saveServerURL)
          .buttonStyle(.borderedProminent)
        Button("Cancel") {
          draftAPIBaseURL = appState.apiBaseURL
          appState.cancelServerEditing()
        }
        .buttonStyle(.bordered)
        Spacer()
      }
      .font(.system(size: 11, weight: .regular))
      .controlSize(.small)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
  }

  private var footer: some View {
    HStack(spacing: 10) {
      ZStack {
        Circle()
          .fill(.blue.opacity(0.22))
        Image(systemName: "chart.bar.xaxis")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(.blue)
      }
      .frame(width: 28, height: 28)

      VStack(alignment: .leading, spacing: 2) {
        Text("Economy")
          .font(.system(size: 11, weight: .medium))
        Text(formatCost(appState.today.total_usd) + " today")
          .font(.system(size: 10).monospacedDigit())
          .foregroundStyle(.secondary)
      }

      Spacer()

      IconFooterButton(systemName: appState.isSyncing ? "hourglass" : "arrow.clockwise", help: "Sync") {
        Task { await appState.syncNow() }
      }

      IconFooterButton(systemName: "power", help: "Quit") {
        NSApp.terminate(nil)
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
  }

  private var spendTrendIcon: String? {
    guard selectedPeriod == .today, averageDaySpend > 0 else { return nil }
    return selectedSummary.total_usd <= averageDaySpend ? "arrow.down" : "arrow.up"
  }

  private var spendTrendColor: Color {
    guard selectedPeriod == .today, averageDaySpend > 0 else { return .secondary }
    return selectedSummary.total_usd <= averageDaySpend ? .green : .orange
  }

  private func toggleServerEditor() {
    draftAPIBaseURL = appState.apiBaseURL
    appState.toggleServerEditor()
  }

  private func openSections() {
    withAnimation(.easeInOut(duration: 0.16)) {
      selectedScreen = .sections
    }
  }

  private func closeSections() {
    if appState.isEditingServer {
      draftAPIBaseURL = appState.apiBaseURL
      appState.cancelServerEditing()
    }
    withAnimation(.easeInOut(duration: 0.16)) {
      selectedScreen = .work
    }
  }

  private var quotaSummaryText: String {
    guard let quota = appState.quotaBadgePct else { return "No active quota pressure" }
    let label = appState.quotaBadgeLabel ?? "Quota"
    return String(format: "%@ %.0f%% used", label, quota)
  }

  private var quotaTint: Color {
    guard let quota = appState.quotaBadgePct else { return .secondary }
    return quota >= 80 ? .orange : .green
  }

  private func manageSubtitle(for sectionID: ManageSectionID) -> String {
    switch sectionID {
    case .workStats:
      return "\(selectedSummary.sessions) sessions, \(formatCost(selectedSummary.total_usd)) \(selectedPeriod.sectionSuffix)"
    case .activity:
      return selectedPeriod == .today ? "Last 12 hours of spend and request pace" : "Daily spend and request pace"
    case .workDetails:
      return selectedPeriod == .today ? "Current pace for today" : "Current pace this week"
    case .machines:
      return "\(selectedMachines.count) active \(selectedPeriod.sectionSuffix)"
    case .agents:
      return "\(selectedAgents.count) agents with synced work"
    case .projects:
      return "\(selectedProjects.count) projects in the selected period"
    case .recentWork:
      return "\(appState.recentSessions.count) latest synced sessions"
    case .accounts:
      return "\(selectedAccounts.count) account rollups"
    case .usageLimits:
      return quotaSummaryText
    case .subscriptions:
      return "\(appState.subscriptionPlans.count) active plans"
    case .savings:
      return formatCost(appState.savedUsd) + " saved versus API pricing"
    }
  }

  private func manageChips(for item: ManageSectionItem) -> [String] {
    var chips: [String] = []

    if item.isDefault {
      chips.append("Default")
    }

    if item.showsBadge {
      chips.append("Badge")
    }

    chips.append(item.isVisible ? "Visible" : "Hidden")

    if item.isCollapsed {
      chips.append("Collapsed")
    }

    return chips
  }

  private func sectionTint(for sectionID: ManageSectionID) -> Color {
    sectionID == .usageLimits ? quotaTint : sectionID.tint
  }

  private func toggleSectionVisible(_ sectionID: ManageSectionID) {
    withAnimation(.easeInOut(duration: 0.16)) {
      updateSection(sectionID) { section in
        section.isVisible.toggle()
      }
    }
  }

  private func toggleSectionCollapsed(_ sectionID: ManageSectionID) {
    withAnimation(.easeInOut(duration: 0.16)) {
      updateSection(sectionID) { section in
        section.isCollapsed.toggle()
        if section.isCollapsed {
          section.isVisible = true
        }
      }
    }
  }

  private func resetSection(_ sectionID: ManageSectionID) {
    guard
      let index = manageSections.firstIndex(where: { $0.id == sectionID }),
      let defaultItem = ManageSectionItem.defaults.first(where: { $0.id == sectionID })
    else { return }

    withAnimation(.easeInOut(duration: 0.16)) {
      manageSections[index] = defaultItem
    }
  }

  private func resetSectionGroup(_ group: ManageSectionGroupKind) {
    withAnimation(.easeInOut(duration: 0.16)) {
      manageSections = ManageSectionGroupKind.allCases.flatMap { currentGroup in
        if currentGroup == group {
          return ManageSectionItem.defaults.filter { $0.group == currentGroup }
        }
        return manageSections.filter { $0.group == currentGroup }
      }
    }
  }

  private func updateSection(_ sectionID: ManageSectionID, mutate: (inout ManageSectionItem) -> Void) {
    guard let index = manageSections.firstIndex(where: { $0.id == sectionID }) else { return }
    mutate(&manageSections[index])
  }

  private func saveServerURL() {
    appState.saveAPIBaseURL(draftAPIBaseURL)
  }

  private func openDashboard() {
    if let url = URL(string: appState.apiBaseURL) {
      openURL(url)
    }
  }
}

private struct ManageSectionsGroup<Content: View>: View {
  let title: String
  let badge: Int?
  let actionTitle: String?
  let action: (() -> Void)?
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Text(title)
          .font(.system(size: 11, weight: .semibold))
          .tracking(0.8)
          .foregroundStyle(.secondary)

        if let badge {
          Text("\(badge)")
            .font(.system(size: 9, weight: .semibold).monospacedDigit())
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(adaptiveBadgeFill, in: Capsule())
        }

        Spacer()

        if let actionTitle, let action {
          Button(action: action) {
            Label(actionTitle, systemImage: "arrow.counterclockwise")
              .font(.system(size: 11, weight: .medium))
          }
          .buttonStyle(.plain)
          .foregroundStyle(.blue)
          .help(actionTitle)
        }
      }

      VStack(alignment: .leading, spacing: 0) {
        content
      }
      .nativeGlassSurface(cornerRadius: 10, material: .ultraThinMaterial, shadow: false)
    }
  }
}

private struct ManageSectionRow: View {
  let item: ManageSectionItem
  let subtitle: String
  let chips: [String]
  let tint: Color
  let isDragging: Bool
  let onToggleVisible: () -> Void
  let onToggleCollapsed: () -> Void
  let onReset: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "line.3.horizontal")
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(isDragging ? AnyShapeStyle(tint) : AnyShapeStyle(.tertiary))
        .frame(width: 12)
        .help("Drag to reorder")

      RowIcon(systemName: item.id.icon, tint: tint)

      VStack(alignment: .leading, spacing: 3) {
        Text(item.id.title)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(item.isVisible ? .primary : .secondary)
          .lineLimit(1)

        Text(subtitle)
          .font(.system(size: 11, weight: .regular))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.tail)
      }

      Spacer(minLength: 10)

      HStack(spacing: 5) {
        ForEach(chips, id: \.self) { chip in
          ManageChip(title: chip)
        }
      }

      Button(action: onToggleVisible) {
        Image(systemName: item.isVisible ? "eye" : "eye.slash")
          .font(.system(size: 11, weight: .medium))
          .frame(width: 24, height: 24)
      }
      .buttonStyle(.plain)
      .foregroundStyle(item.isVisible ? .green : .secondary)
      .help(item.isVisible ? "Hide section" : "Show section")

      Menu {
        Button {
          onToggleVisible()
        } label: {
          Label(item.isVisible ? "Hide section" : "Show section", systemImage: item.isVisible ? "eye.slash" : "eye")
        }

        Button {
          onToggleCollapsed()
        } label: {
          Label(item.isCollapsed ? "Expand section" : "Collapse section", systemImage: item.isCollapsed ? "chevron.down" : "chevron.right")
        }

        Divider()

        Button(action: onReset) {
          Label("Reset section", systemImage: "arrow.counterclockwise")
        }
      } label: {
        Image(systemName: "ellipsis")
          .font(.system(size: 12, weight: .medium))
          .frame(width: 22, height: 24)
      }
      .menuStyle(.borderlessButton)
      .fixedSize()
      .help("Section options")

      Button(action: onToggleCollapsed) {
        Image(systemName: item.isCollapsed ? "chevron.right" : "chevron.down")
          .font(.system(size: 10, weight: .semibold))
          .frame(width: 18, height: 24)
      }
      .buttonStyle(.plain)
      .foregroundStyle(.tertiary)
      .help(item.isCollapsed ? "Expand section" : "Collapse section")
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
    .opacity(isDragging ? 0.58 : 1)
    .contentShape(Rectangle())
  }
}

private struct ManageSectionDropDelegate: DropDelegate {
  let target: ManageSectionID
  @Binding var sections: [ManageSectionItem]
  @Binding var draggingSection: ManageSectionID?

  func dropEntered(info: DropInfo) {
    guard
      let draggingSection,
      draggingSection != target,
      let sourceIndex = sections.firstIndex(where: { $0.id == draggingSection }),
      let targetIndex = sections.firstIndex(where: { $0.id == target }),
      sections[sourceIndex].group == sections[targetIndex].group
    else { return }

    withAnimation(.easeInOut(duration: 0.12)) {
      sections.move(
        fromOffsets: IndexSet(integer: sourceIndex),
        toOffset: targetIndex > sourceIndex ? targetIndex + 1 : targetIndex
      )
    }
  }

  func dropUpdated(info: DropInfo) -> DropProposal? {
    DropProposal(operation: .move)
  }

  func performDrop(info: DropInfo) -> Bool {
    draggingSection = nil
    return true
  }
}

private struct ManageChip: View {
  let title: String

  var body: some View {
    Text(title)
      .font(.system(size: 9, weight: .medium))
      .foregroundStyle(chipTint(title))
      .padding(.horizontal, 6)
      .padding(.vertical, 3)
      .background(chipTint(title).opacity(0.12), in: Capsule())
  }
}

private struct ServerSettingsRow: View {
  let baseURL: String
  let isEditing: Bool
  let action: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      RowIcon(systemName: "network", tint: .blue)

      VStack(alignment: .leading, spacing: 3) {
        Text("Server URL")
          .font(.system(size: 12, weight: .medium))
        Text(baseURL)
          .font(.system(size: 11, weight: .regular))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.middle)
      }

      Spacer(minLength: 10)

      Button(action: action) {
        Text(isEditing ? "Close" : "Edit")
          .font(.system(size: 11, weight: .medium))
          .padding(.horizontal, 9)
          .padding(.vertical, 5)
          .background(.blue.opacity(0.12), in: Capsule())
      }
      .buttonStyle(.plain)
      .foregroundStyle(.blue)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
  }
}

private struct WorkDetailTextMetric: View {
  let label: String
  let value: String

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label)
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(.secondary)
        .lineLimit(1)
      Text(value)
        .font(.system(size: 12, weight: .medium))
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct CompactSignalRow: View {
  let icon: String
  let title: String
  let value: String
  let subtitle: String
  let tint: Color

  var body: some View {
    HStack(spacing: 12) {
      RowIcon(systemName: icon, tint: tint)

      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(size: 12, weight: .medium))
        Text(subtitle)
          .font(.system(size: 11, weight: .regular))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }

      Spacer(minLength: 10)

      Text(value)
        .font(.system(size: 12, weight: .medium).monospacedDigit())
        .lineLimit(1)
        .minimumScaleFactor(0.75)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
  }
}

private struct TopNavItem: View {
  let title: String
  var badge: Int? = nil
  var selected: Bool = false

  var body: some View {
    HStack(spacing: 5) {
      Text(title)
      if let badge, badge > 0 {
        Text("\(badge)")
          .font(.system(size: 9, weight: .semibold).monospacedDigit())
          .foregroundStyle(selected ? .primary : .secondary)
          .padding(.horizontal, 5)
          .padding(.vertical, 2)
          .background(selected ? Color.primary.opacity(0.10) : adaptiveBadgeFill, in: Capsule())
      }
    }
    .font(.system(size: 12, weight: .medium))
    .foregroundStyle(selected ? .primary : .secondary)
    .frame(height: 26)
    .padding(.horizontal, 9)
    .background(selected ? adaptiveSelectedFill : Color.clear, in: Capsule())
    .contentShape(Capsule())
  }
}

private struct PeriodSegmentedControl: View {
  @Binding var selection: WorkPeriod

  var body: some View {
    Picker("Period", selection: $selection) {
      ForEach(WorkPeriod.allCases) { period in
        Text(period.title)
          .tag(period)
      }
    }
    .labelsHidden()
    .pickerStyle(.segmented)
    .controlSize(.small)
    .frame(width: 168)
  }
}

private struct StatusPill: View {
  let icon: String
  let text: String
  let tint: Color

  var body: some View {
    Label(text, systemImage: icon)
      .font(.system(size: 10, weight: .medium))
      .lineLimit(1)
      .foregroundStyle(tint)
      .padding(.horizontal, 9)
      .padding(.vertical, 5)
      .background(adaptiveControlFill, in: Capsule())
  }
}

private struct MachineFilterMenu: View {
  let selectedMachineID: String?
  let currentMachine: String
  let machines: [String]
  let onSelect: (String?) -> Void

  private var labelText: String {
    selectedMachineID ?? "All machines"
  }

  private var isAllMachines: Bool {
    selectedMachineID == nil
  }

  private var machineCountLabel: String? {
    guard isAllMachines, !machines.isEmpty else { return nil }
    return "\(machines.count)"
  }

  var body: some View {
    Menu {
      Button {
        onSelect(nil)
      } label: {
        Label("All machines", systemImage: selectedMachineID == nil ? "checkmark" : "rectangle.stack")
      }

      if !machines.isEmpty {
        Divider()
      }

      ForEach(machines, id: \.self) { machine in
        Button {
          onSelect(machine)
        } label: {
          Label(machineMenuTitle(machine), systemImage: selectedMachineID == machine ? "checkmark" : "desktopcomputer")
        }
      }
    } label: {
      HStack(spacing: 7) {
        ZStack {
          Circle()
            .fill(isAllMachines ? Color.accentColor.opacity(0.14) : Color.primary.opacity(0.08))
          Image(systemName: isAllMachines ? "rectangle.stack" : "desktopcomputer")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(isAllMachines ? Color.accentColor : Color.secondary)
        }
        .frame(width: 22, height: 22)

        Text(labelText)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(.primary)
          .lineLimit(1)
          .truncationMode(.middle)
          .frame(maxWidth: 118, alignment: .leading)

        if let machineCountLabel {
          Text(machineCountLabel)
            .font(.system(size: 9, weight: .semibold).monospacedDigit())
            .foregroundStyle(.secondary)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(adaptiveBadgeFill, in: Capsule())
        }

        Image(systemName: "chevron.down")
          .font(.system(size: 8, weight: .bold))
          .foregroundStyle(.tertiary)
      }
      .padding(.horizontal, 9)
      .padding(.vertical, 5)
      .nativeGlassSurface(cornerRadius: 12, material: .ultraThinMaterial, shadow: false)
    }
    .menuStyle(.borderlessButton)
    .fixedSize(horizontal: false, vertical: false)
    .help("Filter by machine")
  }

  private func machineMenuTitle(_ machine: String) -> String {
    machine == currentMachine ? "\(machine) (this Mac)" : machine
  }
}

private struct StatTile: View {
  let icon: String
  let tint: Color
  let title: String
  let value: String
  var detail: String? = nil
  var trend: String? = nil
  var trendIcon: String? = nil
  let trendColor: Color

  var body: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 8) {
        HStack(alignment: .center) {
          ZStack {
            Circle()
              .fill(tint.opacity(0.20))
            Image(systemName: icon)
              .font(.system(size: 9, weight: .medium))
              .foregroundStyle(tint)
          }
          .frame(width: 20, height: 20)

          Text(title)
            .font(.system(size: 10, weight: .medium))
            .tracking(0.7)
            .foregroundStyle(.secondary)

          Spacer()

          if let trendIcon {
            Image(systemName: trendIcon)
              .font(.system(size: 10, weight: .semibold))
              .foregroundStyle(trendColor)
              .frame(width: 16, height: 16)
          } else if let trend {
            Text(trend)
              .font(.system(size: 9, weight: .regular).monospacedDigit())
              .foregroundStyle(trendColor)
              .lineLimit(1)
              .minimumScaleFactor(0.75)
          }
        }

        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(value)
            .font(.system(size: 14, weight: .regular).monospacedDigit())
            .lineLimit(1)
            .minimumScaleFactor(0.55)

          if let detail {
            Text(detail)
              .font(.system(size: 10, weight: .medium).monospacedDigit())
              .foregroundStyle(.green)
              .lineLimit(1)
              .minimumScaleFactor(0.7)
          }
        }
      }
      .frame(height: 50, alignment: .top)
    }
  }
}

private struct ActivityBars: View {
  let entries: [ActivityBarEntry]

  private var maxCost: Double {
    max(entries.map(\.cost).max() ?? 0, 1)
  }

  private var barSpacing: CGFloat {
    entries.count > 8 ? 8 : 16
  }

  private var barWidth: CGFloat {
    entries.count > 8 ? 20 : 24
  }

  var body: some View {
    HStack(alignment: .bottom, spacing: barSpacing) {
      ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
        VStack(spacing: 6) {
          Text(entry.valueLabel)
            .font(.system(size: 9, weight: .medium).monospacedDigit())
            .foregroundStyle(.secondary)

          RoundedRectangle(cornerRadius: 5, style: .continuous)
            .fill(barColor(index: index))
            .frame(width: barWidth, height: max(14, CGFloat(entry.cost / maxCost) * 54))

          Text(index == entries.count - 1 ? "now" : entry.label)
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
      }
    }
    .frame(height: 84, alignment: .bottom)
  }

  private func barColor(index: Int) -> Color {
    index == entries.count - 1 ? .green : .gray.opacity(0.45)
  }
}

private struct SectionGlassCard<Content: View>: View {
  let title: String
  let badge: Int?
  let actionTitle: String?
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        HStack(spacing: 8) {
          Text(title)
            .font(.system(size: 12, weight: .semibold))
            .tracking(1.0)
            .foregroundStyle(.secondary)
          if let badge, badge > 0 {
            Text("\(badge)")
              .font(.system(size: 10, weight: .semibold).monospacedDigit())
              .foregroundStyle(.secondary)
              .padding(.horizontal, 7)
              .padding(.vertical, 3)
              .background(adaptiveBadgeFill, in: Capsule())
          }
        }

        Spacer()

        if let actionTitle {
          Text(actionTitle)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.blue)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(.blue.opacity(0.12), in: Capsule())
        }
      }
      .padding(.bottom, 8)

      VStack(alignment: .leading, spacing: 0) {
        content
      }
      .nativeGlassSurface(cornerRadius: 10, material: .ultraThinMaterial, shadow: false)
    }
  }
}

private struct GlassCard<Content: View>: View {
  @ViewBuilder let content: Content

  var body: some View {
    content
      .padding(12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .nativeGlassSurface(cornerRadius: 12, material: .thinMaterial)
  }
}

private struct CollapsedSectionCard: View {
  let title: String
  let icon: String
  let tint: Color

  var body: some View {
    GlassCard {
      HStack(spacing: 10) {
        RowIcon(systemName: icon, tint: tint)

        Text(title)
          .font(.system(size: 13, weight: .medium))

        Spacer()

        Text("Collapsed")
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
          .background(adaptiveBadgeFill, in: Capsule())
      }
    }
  }
}

private struct EconomyMachineRow: View {
  let machine: FleetMachine
  let currentMachine: String

  private var isCurrent: Bool {
    machine.machine_id == currentMachine
  }

  var body: some View {
    HStack(spacing: 12) {
      RowIcon(systemName: isCurrent ? "desktopcomputer" : "server.rack", tint: isCurrent ? .blue : .secondary)

      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 7) {
          Text(machine.displayName)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)

          if isCurrent {
            Text("THIS MAC")
              .font(.system(size: 9, weight: .bold))
              .foregroundStyle(.blue)
              .padding(.horizontal, 6)
              .padding(.vertical, 3)
              .background(.blue.opacity(0.12), in: Capsule())
          }
        }
        Text("\(machine.sessions) sessions  \(machine.requests) requests")
          .font(.system(size: 11).monospacedDigit())
          .foregroundStyle(.secondary)
      }

      Spacer(minLength: 10)

      Text(formatCost(machine.total_cost_usd))
        .font(.system(size: 12, weight: .semibold).monospacedDigit())
        .lineLimit(1)
        .minimumScaleFactor(0.75)

      Image(systemName: "chevron.right")
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(.tertiary)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
  }
}

private struct EconomyAgentRow: View {
  let agent: AgentStat

  var body: some View {
    HStack(spacing: 12) {
      RowIcon(systemName: agentIcon(agent.agent), tint: agentTint(agent.agent))

      VStack(alignment: .leading, spacing: 3) {
        Text(agent.displayName)
          .font(.system(size: 12, weight: .semibold))
          .lineLimit(1)
        Text("\(agent.sessions) sessions  \(formatTokens(agent.total_tokens)) tokens")
          .font(.system(size: 11).monospacedDigit())
          .foregroundStyle(.secondary)
      }

      Spacer(minLength: 10)

      Text(formatCost(agent.api_equivalent_usd))
        .font(.system(size: 12, weight: .semibold).monospacedDigit())
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
  }
}

private struct EconomyProjectRow: View {
  let project: ProjectStat

  var body: some View {
    HStack(spacing: 12) {
      RowIcon(systemName: "folder", tint: .orange)

      VStack(alignment: .leading, spacing: 3) {
        Text(project.displayName)
          .font(.system(size: 12, weight: .semibold))
          .lineLimit(1)
          .truncationMode(.middle)
        Text("\(project.sessions) sessions  \(project.requests ?? 0) requests")
          .font(.system(size: 11).monospacedDigit())
          .foregroundStyle(.secondary)
      }

      Spacer(minLength: 10)

      Text(formatCost(project.cost_usd))
        .font(.system(size: 12, weight: .semibold).monospacedDigit())
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
  }
}

private struct EconomySessionRow: View {
  let session: SessionStat

  var body: some View {
    HStack(spacing: 12) {
      RowIcon(systemName: agentIcon(session.agent), tint: agentTint(session.agent))

      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 7) {
          Text(session.displayProject)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
            .truncationMode(.middle)
          Text(session.agent.uppercased())
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.secondary)
        }

        Text("\(session.startedAtLabel)  \(session.request_count) requests")
          .font(.system(size: 11).monospacedDigit())
          .foregroundStyle(.secondary)
      }

      Spacer(minLength: 10)

      Text(formatCost(session.total_cost_usd))
        .font(.system(size: 12, weight: .semibold).monospacedDigit())
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
  }
}

private struct EmptySectionRow: View {
  let icon: String
  let text: String

  var body: some View {
    HStack(spacing: 12) {
      RowIcon(systemName: icon, tint: .secondary)
      Text(text)
        .font(.system(size: 12, weight: .regular))
        .foregroundStyle(.secondary)
      Spacer()
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 13)
  }
}

private struct RowIcon: View {
  let systemName: String
  let tint: Color

  var body: some View {
    ZStack {
      Circle()
        .fill(tint.opacity(0.12))
      Image(systemName: systemName)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(tint)
    }
    .frame(width: 24, height: 24)
  }
}

private struct IconFooterButton: View {
  let systemName: String
  let help: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: systemName)
        .font(.system(size: 12, weight: .semibold))
        .frame(width: 28, height: 28)
        .background(adaptiveControlFill, in: Circle())
    }
    .buttonStyle(.plain)
    .help(help)
  }
}

private extension View {
  @ViewBuilder
  func nativeGlassSurface(cornerRadius: CGFloat, material: Material, shadow: Bool = true) -> some View {
    let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

    #if compiler(>=6.2)
    if #available(macOS 26.0, *) {
      self
        .glassEffect(.regular, in: shape)
        .softNativeShadow(enabled: shadow)
    } else {
      self
        .background(material, in: shape)
        .softNativeShadow(enabled: shadow)
    }
    #else
    self
      .background(material, in: shape)
      .softNativeShadow(enabled: shadow)
    #endif
  }

  @ViewBuilder
  func softNativeShadow(enabled: Bool = true) -> some View {
    if enabled {
      self.shadow(color: .black.opacity(0.07), radius: 8, x: 0, y: 3)
    } else {
      self
    }
  }
}

private func formatCost(_ usd: Double) -> String {
  if usd >= 10_000 { return String(format: "$%.0fk", usd / 1_000) }
  if usd >= 1_000 { return String(format: "$%.1fk", usd / 1_000) }
  if usd >= 0.01 { return String(format: "$%.2f", usd) }
  if usd > 0 { return String(format: "$%.1f cents", usd * 100) }
  return "$0.00"
}

private func formatCount(_ value: Int) -> String {
  if value >= 1_000_000 { return String(format: "%.1fM", Double(value) / 1_000_000) }
  if value >= 1_000 { return String(format: "%.1fk", Double(value) / 1_000) }
  return "\(value)"
}

private func formatTokens(_ tokens: Int) -> String {
  if tokens >= 1_000_000_000 { return String(format: "%.1fB", Double(tokens) / 1_000_000_000) }
  if tokens >= 1_000_000 { return String(format: "%.1fM", Double(tokens) / 1_000_000) }
  if tokens >= 1_000 { return String(format: "%.1fk", Double(tokens) / 1_000) }
  return "\(tokens)"
}

private func activityValue(_ cost: Double) -> String {
  if cost >= 1000 { return String(format: "$%.0fk", cost / 1000) }
  if cost >= 1 { return String(format: "$%.0f", cost) }
  if cost > 0 { return String(format: "%.1f", cost) }
  return "$0"
}

private func currentUTCHour() -> Int {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(secondsFromGMT: 0)!
  return calendar.component(.hour, from: Date())
}

private func activityDateLabel(_ date: String) -> String {
  let input = DateFormatter()
  input.dateFormat = "yyyy-MM-dd"
  guard let parsed = input.date(from: date) else { return date }
  let output = DateFormatter()
  output.dateFormat = "MMM d"
  return output.string(from: parsed)
}

private func activityHourLabel(_ hour: String) -> String {
  guard let hourValue = Int(hour) else { return hour }
  if hourValue == 0 { return "12a" }
  if hourValue < 12 { return "\(hourValue)a" }
  if hourValue == 12 { return "12p" }
  return "\(hourValue - 12)p"
}

private func agentIcon(_ agent: String) -> String {
  switch agent.lowercased() {
  case "claude": return "sparkles"
  case "codex": return "terminal"
  case "cursor": return "cursorarrow.rays"
  case "gemini": return "diamond"
  case "opencode": return "curlybraces"
  case "pi": return "person.wave.2"
  case "hermes": return "bolt.horizontal"
  default: return "cpu"
  }
}

private func agentTint(_ agent: String) -> Color {
  switch agent.lowercased() {
  case "claude": return .orange
  case "codex": return .green
  case "cursor": return .blue
  case "gemini": return .purple
  case "opencode": return .mint
  case "pi": return .pink
  case "hermes": return .yellow
  default: return .secondary
  }
}

private func chipTint(_ title: String) -> Color {
  switch title.lowercased() {
  case "default": return .blue
  case "badge": return .orange
  case "visible": return .green
  case "hidden": return .red
  case "collapsed": return .secondary
  default: return .secondary
  }
}
