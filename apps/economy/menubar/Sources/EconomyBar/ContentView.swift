import SwiftUI

struct ContentView: View {
  @EnvironmentObject var appState: AppState
  @Environment(\.openURL) private var openURL
  @State private var showAllProjects = false

  private var lastUpdatedText: String {
    guard let date = appState.lastUpdated else { return "Never" }
    let seconds = Int(-date.timeIntervalSinceNow)
    if seconds < 60 { return "\(seconds)s ago" }
    return "\(seconds / 60)m ago"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {

      // Header
      HStack(alignment: .firstTextBaseline) {
        Text("Economy")
          .font(.headline)
        Spacer()
        Text(lastUpdatedText)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 16)
      .padding(.top, 14)
      .padding(.bottom, 12)

      Divider()
        .padding(.horizontal, 0)

      if appState.isOffline {
        OfflineView()
          .padding(.horizontal, 16)
      } else {

        // Cost rows
        VStack(spacing: 0) {
          HStack(spacing: 0) {
            CostCardView(
              label: "Today",
              cost: appState.today.total_usd,
              sessions: appState.today.sessions
            )
            CostCardView(
              label: "Month",
              cost: appState.month.total_usd,
              sessions: appState.month.sessions
            )
          }
          HStack(spacing: 0) {
            CostCardView(
              label: "Year",
              cost: appState.year.total_usd,
              sessions: appState.year.sessions
            )
            Spacer()
              .frame(maxWidth: .infinity)
          }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)

        // Sparkline
        if !appState.dailyEntries.isEmpty {
          Divider()
          SparklineView(entries: appState.dailyEntries)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }

        // Goals
        if !appState.goals.isEmpty {
          Divider()
          GoalProgressView(goals: appState.goals)
        }

        // Top projects
        if !appState.topProjects.isEmpty {
          Divider()
          VStack(alignment: .leading, spacing: 0) {
            Text("TOP PROJECTS")
              .font(.caption)
              .fontWeight(.semibold)
              .foregroundStyle(.secondary)
              .padding(.bottom, 8)

            let displayed = showAllProjects ? appState.allProjects : appState.topProjects
            ForEach(Array(displayed.enumerated()), id: \.element.id) { i, project in
              if i > 0 { Divider().padding(.vertical, 5) }
              ProjectRowView(project: project)
            }

            if appState.allProjects.count > 3 {
              Button(action: { withAnimation(.easeInOut(duration: 0.2)) { showAllProjects.toggle() } }) {
                HStack {
                  Text(showAllProjects ? "Show less" : "Show \(appState.allProjects.count - 3) more")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                  Spacer()
                  Image(systemName: showAllProjects ? "chevron.up" : "chevron.down")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
              }
              .buttonStyle(.plain)
              .padding(.top, 6)
            }
          }
          .padding(.horizontal, 16)
          .padding(.vertical, 12)
        }
      }

      Divider()

      // Action buttons
      HStack(spacing: 8) {
        Button(action: { Task { await appState.syncNow() } }) {
          HStack(spacing: 5) {
            if appState.isSyncing {
              ProgressView().controlSize(.mini)
            } else {
              Image(systemName: "arrow.clockwise")
            }
            Text("Sync")
          }
        }
        .buttonStyle(.glass)

        Button(action: { openURL(URL(string: "http://localhost:3456")!) }) {
          HStack(spacing: 5) {
            Image(systemName: "safari")
            Text("Dashboard")
          }
        }
        .buttonStyle(.glass)

        Spacer()

        Button(action: { NSApp.terminate(nil) }) {
          Text("Quit")
        }
        .buttonStyle(.glass)
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
    }
    .frame(width: 320)
    .onAppear { appState.startPolling() }
  }
}
