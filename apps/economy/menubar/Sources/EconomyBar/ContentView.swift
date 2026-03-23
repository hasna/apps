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
    VStack(alignment: .leading, spacing: 0) {

      // Header — fixed, always visible
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

      // Scrollable body — fixed height prevents NSHostingView crash on dynamic resize
      ScrollView(.vertical, showsIndicators: false) {
        VStack(alignment: .leading, spacing: 0) {

          if appState.isOffline {
            OfflineView()
              .padding(.horizontal, 16)
              .padding(.vertical, 12)
          } else {

            // Cost rows
            VStack(spacing: 8) {
              CostCardView(label: "Today",     cost: appState.today.total_usd,     sessions: appState.today.sessions)
              CostCardView(label: "Yesterday", cost: appState.yesterday.total_usd, sessions: appState.yesterday.sessions)
              CostCardView(label: "Month",     cost: appState.month.total_usd,     sessions: appState.month.sessions)
              CostCardView(label: "Year",      cost: appState.year.total_usd,      sessions: appState.year.sessions)
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

                ForEach(Array(appState.topProjects.enumerated()), id: \.element.id) { i, project in
                  if i > 0 { Divider().padding(.vertical, 4) }
                  ProjectRowView(project: project)
                }
              }
              .padding(.horizontal, 16)
              .padding(.vertical, 12)
            }
          }
        }
      }

      Divider()

      // Action buttons — fixed footer
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
