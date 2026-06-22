import SwiftUI

@main
struct OpenKnowledgeApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onAppear {
                    Task { await model.refresh() }
                }
                .onOpenURL { url in
                    model.openWorkspaceFromURL(url)
                }
        }
        .windowStyle(.automatic)
        .windowToolbarStyle(.unified)
        .defaultSize(width: 1120, height: 760)

        Settings {
            SettingsView()
                .environmentObject(model)
                .frame(width: 640, height: 520)
        }
    }
}
