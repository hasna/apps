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
      MenuBarLabel(cost: appState.today.total_usd, isOffline: appState.isOffline)
    }
    .menuBarExtraStyle(.window)
  }
}
