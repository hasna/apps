import SwiftUI
import AppKit

@main
struct EconomyMenubarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate, ObservableObject {
    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private var timer: Timer?
    @Published var stats = EconomyStats()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // hide from dock

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.title = "$—"
            button.action = #selector(togglePopover)
            button.target = self
        }

        let contentView = PopoverView(delegate: self)
        popover = NSPopover()
        popover.contentSize = NSSize(width: 340, height: 460)
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: contentView)

        // Initial fetch + sync
        Task { await syncAndRefresh() }

        // Auto-sync every 30 seconds
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { await self?.syncAndRefresh() }
        }
    }

    @objc func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    @MainActor
    func syncAndRefresh() async {
        // Trigger sync via API
        let syncURL = URL(string: "\(apiBase)/api/sync")!
        var syncReq = URLRequest(url: syncURL)
        syncReq.httpMethod = "POST"
        syncReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        syncReq.httpBody = "{\"sources\":\"all\"}".data(using: .utf8)
        _ = try? await URLSession.shared.data(for: syncReq)

        // Fetch summaries
        async let today = fetchSummary("today")
        async let week = fetchSummary("week")
        async let month = fetchSummary("month")
        async let projects = fetchProjects()

        let t = await today
        let w = await week
        let m = await month
        let p = await projects

        stats = EconomyStats(
            today: t, week: w, month: m,
            topProjects: Array(p.prefix(5)),
            lastSync: Date()
        )

        // Update menu bar title
        if let button = statusItem.button {
            button.title = formatUsd(t)
        }
    }

    private var apiBase: String {
        ProcessInfo.processInfo.environment["ECONOMY_URL"] ?? "http://localhost:3456"
    }

    private func fetchSummary(_ period: String) async -> Double {
        guard let url = URL(string: "\(apiBase)/api/summary?period=\(period)") else { return 0 }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let d = json?["data"] as? [String: Any]
            return d?["total_usd"] as? Double ?? 0
        } catch { return 0 }
    }

    private func fetchProjects() async -> [ProjectStat] {
        guard let url = URL(string: "\(apiBase)/api/projects") else { return [] }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let arr = json?["data"] as? [[String: Any]] else { return [] }
            return arr.compactMap { item in
                guard let name = item["project_name"] as? String,
                      let cost = item["cost_usd"] as? Double else { return nil }
                return ProjectStat(name: name, cost: cost)
            }.sorted { $0.cost > $1.cost }
        } catch { return [] }
    }
}

// MARK: - Data Models

struct EconomyStats {
    var today: Double = 0
    var week: Double = 0
    var month: Double = 0
    var topProjects: [ProjectStat] = []
    var lastSync: Date? = nil
}

struct ProjectStat: Identifiable {
    let id = UUID()
    let name: String
    let cost: Double
}

// MARK: - Format

func formatUsd(_ n: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = "USD"
    formatter.maximumFractionDigits = 2
    formatter.minimumFractionDigits = 2
    return formatter.string(from: NSNumber(value: n)) ?? "$0.00"
}

func timeAgo(_ date: Date?) -> String {
    guard let date = date else { return "Not synced" }
    let seconds = Int(-date.timeIntervalSinceNow)
    if seconds < 5 { return "Just now" }
    if seconds < 60 { return "\(seconds)s ago" }
    if seconds < 3600 { return "\(seconds / 60)m ago" }
    return "\(seconds / 3600)h ago"
}

// MARK: - SwiftUI Popover View

struct PopoverView: View {
    @ObservedObject var delegate: AppDelegate

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text("ECONOMY")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .tracking(0.8)
                Spacer()
                Circle()
                    .fill(delegate.stats.lastSync != nil ? Color.green : Color.orange)
                    .frame(width: 6, height: 6)
            }
            .padding(.bottom, 4)

            // Today's cost — big number
            Text(formatUsd(delegate.stats.today))
                .font(.system(size: 42, weight: .bold, design: .rounded))
                .tracking(-1.5)
                .foregroundStyle(.primary)

            Text("today")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .padding(.bottom, 16)

            // Week / Month row
            HStack(spacing: 12) {
                StatBox(label: "This Week", value: formatUsd(delegate.stats.week))
                StatBox(label: "This Month", value: formatUsd(delegate.stats.month))
            }
            .padding(.bottom, 18)

            // Top Projects
            Text("TOP PROJECTS")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
                .tracking(0.5)
                .padding(.bottom, 8)

            if delegate.stats.topProjects.isEmpty {
                Text("No projects yet")
                    .font(.system(size: 12))
                    .foregroundStyle(.tertiary)
                    .italic()
                    .padding(.bottom, 8)
            } else {
                VStack(spacing: 0) {
                    ForEach(delegate.stats.topProjects) { project in
                        HStack {
                            Text(project.name)
                                .font(.system(size: 13, weight: .medium))
                                .lineLimit(1)
                                .truncationMode(.tail)
                            Spacer()
                            Text(formatUsd(project.cost))
                                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                        }
                        .padding(.vertical, 6)
                        if project.id != delegate.stats.topProjects.last?.id {
                            Divider()
                        }
                    }
                }
                .padding(.bottom, 8)
            }

            // Last sync
            HStack(spacing: 6) {
                Circle()
                    .fill(delegate.stats.lastSync != nil ? Color.green : Color.orange)
                    .frame(width: 6, height: 6)
                Text("Last sync: \(timeAgo(delegate.stats.lastSync))")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            .padding(.bottom, 14)

            // Buttons
            HStack(spacing: 8) {
                Button {
                    Task { await delegate.syncAndRefresh() }
                } label: {
                    Text("Sync Now")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    if let url = URL(string: "http://localhost:3456") {
                        NSWorkspace.shared.open(url)
                    }
                } label: {
                    Text("Dashboard")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.bordered)
            }
            .padding(.bottom, 10)

            // Quit
            Button {
                NSApp.terminate(nil)
            } label: {
                Text("Quit")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
        }
        .padding(20)
        .frame(width: 340)
        .background(.ultraThinMaterial)
    }
}

// MARK: - Stat Box

struct StatBox: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.primary)
            Text(label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
                .tracking(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
