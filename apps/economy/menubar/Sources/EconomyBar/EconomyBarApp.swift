import SwiftUI

@main
struct EconomyBarApp: App {
  @StateObject private var appState = AppState()

  var body: some Scene {
    MenuBarExtra {
      ContentView()
        .environmentObject(appState)
        .background(.clear)
    } label: {
      MenuBarLabel(
        todayCost: appState.today.total_usd,
        weekCost: appState.week.total_usd,
        monthCost: appState.month.total_usd,
        isOffline: appState.isOffline
      )
      .task {
        // Start polling when the menubar label first mounts (app launch),
        // not when the user opens the menu. Ensures the label shows real
        // data immediately instead of $0.
        appState.startPolling()
      }
    }
    .menuBarExtraStyle(.window)
  }
}
