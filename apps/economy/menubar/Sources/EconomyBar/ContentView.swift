import SwiftUI

struct ContentView: View {
  @EnvironmentObject var appState: AppState
  @Environment(\.openURL) private var openURL
  @State private var draftBaseURL: String = APIClient.storedBaseURL()

  private var lastUpdatedText: String {
    guard let date = appState.lastUpdated else { return "Never" }
    let seconds = Int(-date.timeIntervalSinceNow)
    if seconds < 60 { return "\(seconds)s ago" }
    return "\(seconds / 60)m ago"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline) {
        Text("Hasna Economy")
          .font(.headline)

        Text(appState.apiBaseURL.replacingOccurrences(of: "http://", with: "").replacingOccurrences(of: "https://", with: ""))
          .font(.caption2)
          .foregroundStyle(.tertiary)

        Spacer()

        Button(action: {
          draftBaseURL = appState.apiBaseURL
          appState.toggleServerEditor()
        }) {
          Image(systemName: "slider.horizontal.3")
        }
        .buttonStyle(.plain)

        Text(lastUpdatedText)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 16)
      .padding(.top, 14)
      .padding(.bottom, 12)

      if appState.isEditingServer {
        Divider()
        VStack(alignment: .leading, spacing: 8) {
          Text("Server URL")
            .font(.caption)
            .foregroundStyle(.secondary)

          TextField("http://127.0.0.1:3456", text: $draftBaseURL)
            .textFieldStyle(.roundedBorder)

          HStack(spacing: 8) {
            Button("Save") {
              appState.saveAPIBaseURL(draftBaseURL)
            }
            .buttonStyle(.glass)

            Button("Cancel") {
              draftBaseURL = appState.apiBaseURL
              appState.cancelServerEditing()
            }
            .buttonStyle(.plain)

            Spacer()
          }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
      }

      Divider()

      ScrollView(.vertical, showsIndicators: false) {
        VStack(alignment: .leading, spacing: 0) {
          if appState.isOffline {
            OfflineView(baseURL: appState.apiBaseURL)
              .padding(.horizontal, 16)
              .padding(.vertical, 12)
          } else {
            LazyVGrid(
              columns: [
                GridItem(.flexible(), spacing: 8),
                GridItem(.flexible(), spacing: 8),
                GridItem(.flexible(), spacing: 8),
              ],
              spacing: 8
            ) {
              CostCardView(label: "Today", cost: appState.today.total_usd, sessions: appState.today.sessions)
              CostCardView(label: "Week", cost: appState.week.total_usd, sessions: appState.week.sessions)
              CostCardView(label: "Month", cost: appState.month.total_usd, sessions: appState.month.sessions)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            if !appState.dailyEntries.isEmpty {
              Divider()
              SparklineView(entries: appState.dailyEntries)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }

            Divider()
            VStack(alignment: .leading, spacing: 8) {
              Text(appState.sessionQuery.isEmpty ? "RECENT SESSIONS" : "SESSION SEARCH")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)

              TextField(
                "Search sessions or projects",
                text: Binding(
                  get: { appState.sessionQuery },
                  set: { appState.setSessionQuery($0) }
                )
              )
              .textFieldStyle(.roundedBorder)

              if appState.recentSessions.isEmpty {
                Text(appState.sessionQuery.isEmpty ? "No sessions synced yet." : "No matching sessions.")
                  .font(.caption)
                  .foregroundStyle(.secondary)
                  .padding(.top, 4)
              } else {
                ForEach(Array(appState.recentSessions.enumerated()), id: \.element.id) { i, session in
                  if i > 0 { Divider().padding(.vertical, 4) }
                  SessionRowView(session: session)
                }
              }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

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

        Button(action: {
          if let url = URL(string: appState.apiBaseURL) {
            openURL(url)
          }
        }) {
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
    .frame(width: 360)
    .onAppear {
      draftBaseURL = appState.apiBaseURL
      appState.startPolling()
    }
  }
}
