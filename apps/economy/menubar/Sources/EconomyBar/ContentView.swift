import SwiftUI

struct ContentView: View {
  @EnvironmentObject var appState: AppState
  @Environment(\.openURL) private var openURL

  private var lastUpdatedText: String {
    guard let date = appState.lastUpdated else { return "Never" }
    let seconds = Int(-date.timeIntervalSinceNow)
    if seconds < 60 { return "\(seconds)s ago" }
    return "\(seconds / 60)m ago"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      // Header
      HStack {
        Text("Economy Bar")
          .font(.system(size: 13, weight: .semibold))
        Spacer()
        Text(lastUpdatedText)
          .font(.system(size: 10))
          .foregroundStyle(.tertiary)
      }

      Divider()

      if appState.isOffline {
        OfflineView()
      } else {
        // Cost cards
        HStack(spacing: 8) {
          CostCardView(label: "Today", cost: appState.today.total_usd, sessions: appState.today.sessions)
          CostCardView(label: "Month", cost: appState.month.total_usd, sessions: appState.month.sessions)
        }

        // Sparkline
        if !appState.dailyEntries.isEmpty {
          SparklineView(entries: appState.dailyEntries)
        }

        // Top projects
        if !appState.topProjects.isEmpty {
          VStack(alignment: .leading, spacing: 4) {
            Text("TOP PROJECTS")
              .font(.system(size: 10, weight: .semibold))
              .foregroundStyle(.secondary)
            ForEach(appState.topProjects) { project in
              ProjectRowView(project: project)
            }
          }
        }
      }

      Divider()

      // Action buttons
      HStack(spacing: 6) {
        Button(action: {
          Task { await appState.syncNow() }
        }) {
          HStack(spacing: 4) {
            if appState.isSyncing {
              ProgressView().controlSize(.mini)
            } else {
              Image(systemName: "arrow.clockwise")
            }
            Text("Sync")
          }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)

        Button(action: {
          openURL(URL(string: "http://localhost:3456")!)
        }) {
          HStack(spacing: 4) {
            Image(systemName: "safari")
            Text("Dashboard")
          }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)

        Spacer()

        Button(action: {
          NSApp.terminate(nil)
        }) {
          Text("Quit")
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
      }
    }
    .padding(12)
    .frame(width: 280)
    .onAppear {
      appState.startPolling()
    }
    .onDisappear {
      // Don't stop polling — keep refreshing in background
    }
  }
}
