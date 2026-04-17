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
    }
    .menuBarExtraStyle(.window)
  }
}
