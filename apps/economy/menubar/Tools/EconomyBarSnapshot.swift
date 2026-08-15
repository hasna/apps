import AppKit
import Foundation
import SwiftUI

@main
struct EconomyBarSnapshot {
  @MainActor
  static func main() async throws {
    let arguments = CommandLine.arguments
    let outputPath = arguments.dropFirst().first ?? "/tmp/economybar-stats.png"
    let screen = arguments.dropFirst(2).first ?? "stats"

    if screen == "sections" {
      setenv("ECONOMYBAR_SCREEN", "sections", 1)
    } else {
      unsetenv("ECONOMYBAR_SCREEN")
    }

    let appState = AppState()
    await appState.refresh()
    if appState.today.sessions == 0 && appState.week.sessions == 0
      || appState.fleetMachines.isEmpty
      || appState.todayAgents.isEmpty
      || appState.todayProjects.isEmpty {
      seedFallbackData(appState)
    }

    let width: CGFloat = 560
    let height: CGFloat = 660
    let scale: CGFloat = 2
    let content = ContentView()
      .environmentObject(appState)
      .frame(width: width, height: height)
    let hostingView = NSHostingView(rootView: content)
    hostingView.frame = NSRect(x: 0, y: 0, width: width, height: height)

    let window = NSWindow(
      contentRect: hostingView.frame,
      styleMask: [.borderless],
      backing: .buffered,
      defer: false
    )
    window.contentView = hostingView
    hostingView.layoutSubtreeIfNeeded()

    guard let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: Int(width * scale),
      pixelsHigh: Int(height * scale),
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bytesPerRow: 0,
      bitsPerPixel: 0
    ) else {
      throw SnapshotError.renderFailed
    }
    bitmap.size = NSSize(width: width, height: height)
    hostingView.cacheDisplay(in: hostingView.bounds, to: bitmap)

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
      throw SnapshotError.renderFailed
    }

    try png.write(to: URL(fileURLWithPath: outputPath))
  }

  @MainActor
  private static func seedFallbackData(_ appState: AppState) {
    appState.today = CostSummary(total_usd: 384.68, sessions: 8, requests: 588, tokens: 153_237_370)
    appState.week = CostSummary(total_usd: 3_622.82, sessions: 49, requests: 4_883, tokens: 1_744_253_237)
    appState.dailyEntries = [
      DailyEntry(date: "2026-05-30", agent: "codex", cost_usd: 90),
      DailyEntry(date: "2026-05-31", agent: "claude", cost_usd: 12),
      DailyEntry(date: "2026-06-01", agent: "codex", cost_usd: 420),
      DailyEntry(date: "2026-06-02", agent: "claude", cost_usd: 760),
      DailyEntry(date: "2026-06-03", agent: "codex", cost_usd: 540),
      DailyEntry(date: "2026-06-04", agent: "cursor", cost_usd: 310),
      DailyEntry(date: "2026-06-05", agent: "codex", cost_usd: 384.68),
    ]
    appState.fleetMachines = [
      FleetMachine(machine_id: "spark02", sessions: 6, requests: 356, total_cost_usd: 329.73, last_active: nil),
      FleetMachine(machine_id: "apple06", sessions: 2, requests: 232, total_cost_usd: 54.95, last_active: nil),
    ]
    appState.weekFleetMachines = [
      FleetMachine(machine_id: "spark02", sessions: 16, requests: 3_376, total_cost_usd: 2_691.10, last_active: nil),
      FleetMachine(machine_id: "apple06", sessions: 32, requests: 1_495, total_cost_usd: 920.25, last_active: nil),
      FleetMachine(machine_id: "apple03", sessions: 1, requests: 12, total_cost_usd: 11.47, last_active: nil),
    ]
    appState.allMachines = [
      FleetMachine(machine_id: "spark02", sessions: 16, requests: 3_376, total_cost_usd: 2_691.10, last_active: nil),
      FleetMachine(machine_id: "apple06", sessions: 32, requests: 1_495, total_cost_usd: 920.25, last_active: nil),
      FleetMachine(machine_id: "apple03", sessions: 1, requests: 12, total_cost_usd: 11.47, last_active: nil),
      FleetMachine(machine_id: "spark01", sessions: 0, requests: 0, total_cost_usd: 0, last_active: nil),
    ]
    appState.todayAgents = [
      AgentStat(agent: "codex", sessions: 5, requests: 390, total_tokens: 101_000_000, api_equivalent_usd: 250, billable_usd: 0, metered_api_usd: 0, subscription_included_usd: 0, estimated_usd: 0, unknown_usd: 0, cost_usd: 250, last_active: nil),
      AgentStat(agent: "claude", sessions: 3, requests: 198, total_tokens: 52_237_370, api_equivalent_usd: 134.68, billable_usd: 0, metered_api_usd: 0, subscription_included_usd: 0, estimated_usd: 0, unknown_usd: 0, cost_usd: 134.68, last_active: nil),
    ]
    appState.weekAgents = appState.todayAgents
    appState.todayProjects = [
      ProjectStat(project_path: "/Users/hasna/Workspace/open-economy", project_name: "open-economy", sessions: 6, requests: 356, total_tokens: 110_000_000, cost_usd: 329.73, last_active: nil),
      ProjectStat(project_path: "/Users/hasna/Workspace/automation", project_name: "automation", sessions: 2, requests: 232, total_tokens: 43_237_370, cost_usd: 54.95, last_active: nil),
    ]
    appState.weekProjects = appState.todayProjects
    appState.recentSessions = [
      SessionStat(id: "snapshot-codex-1", agent: "codex", project_path: nil, project_name: "open-economy", total_cost_usd: 82.24, total_tokens: 24_000_000, request_count: 122, started_at: "2026-06-05T13:03:39Z", ended_at: nil),
      SessionStat(id: "snapshot-claude-1", agent: "claude", project_path: nil, project_name: "automation", total_cost_usd: 48.13, total_tokens: 12_000_000, request_count: 64, started_at: "2026-06-05T10:28:21Z", ended_at: nil),
    ]
    appState.topAccounts = [
      AccountStat(account_key: "codex:hasna", account_tool: "codex", account_name: "hasna", account_email: nil, account_source: "local", sessions: 5, requests: 390, total_tokens: 101_000_000, api_equivalent_usd: 250, billable_usd: 0, metered_api_usd: 0, subscription_included_usd: 0, estimated_usd: 0, unknown_usd: 0, cost_usd: 250, last_active: nil),
    ]
    appState.subscriptionPlans = [
      SubscriptionPlan(id: "codex-pro", agent: "codex", provider: "OpenAI", plan: "Pro", monthly_fee_usd: 200, included_usage_usd: 0, billing_cycle_start: nil, reset_policy: "monthly", active: 1),
    ]
    appState.savedUsd = 1_200
    appState.quotaBadgePct = 42
    appState.quotaBadgeLabel = "Codex"
    appState.machineCount = 4
    appState.currentMachine = "apple06"
    appState.lastUpdated = Date()
  }
}

private enum SnapshotError: Error {
  case renderFailed
}
